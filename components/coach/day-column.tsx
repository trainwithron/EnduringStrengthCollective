"use client";

import { useState } from "react";
import Link from "next/link";
import { createBrowserClient } from "@/lib/supabase/client";
import type { BuilderDay, BuilderItem, BuilderExercise, BuilderNote } from "@/lib/types";
import { DEFAULT_TRACKED_FIELDS, SET_ROW_SELECT, mapSetRow } from "@/lib/exercise-fields";
import { ExerciseBuilderCard, type MovementPatternOption } from "./exercise-builder-card";
import { TextNoteCard } from "./text-note-card";
import { clampCardWidth } from "@/lib/builder-prefs";
import { formatShortDate } from "@/lib/program-schedule";
import { ChevronLeft, ChevronRight, GripVertical, Maximize2, Minimize2 } from "lucide-react";

const COLLAPSED_WIDTH = 44;

export function DayColumn({
  day,
  scheduledDate,
  groupId,
  exerciseLibrary,
  movementPatterns,
  cardWidthPx,
  onCardWidthChange,
  canMoveLeft,
  canMoveRight,
  onMoveLeft,
  onMoveRight,
  onUpdate,
  onItemsChange,
  onDeleted,
}: {
  day: BuilderDay;
  scheduledDate?: Date;
  groupId: string;
  exerciseLibrary: string[];
  movementPatterns: MovementPatternOption[];
  cardWidthPx: number;
  onCardWidthChange: (px: number, commit: boolean) => void;
  canMoveLeft: boolean;
  canMoveRight: boolean;
  onMoveLeft: () => void;
  onMoveRight: () => void;
  onUpdate: (patch: Partial<Pick<BuilderDay, "title">>) => void;
  onItemsChange: (items: BuilderItem[]) => void;
  onDeleted: () => void;
}) {
  const [titleDraft, setTitleDraft] = useState(day.title);
  const [draggedItemId, setDraggedItemId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [resizing, setResizing] = useState(false);
  // Per-day, not persisted — a coach clears a finished day off-screen to
  // free up horizontal room for the days still ahead, same session-only
  // convenience as the per-exercise and per-week collapse toggles.
  const [collapsed, setCollapsed] = useState(false);

  // Drag-to-resize the column's right edge — updates every column's width
  // together (they share one value) for a live preview while dragging, and
  // persists once on release. Pointer Events unify mouse and touch so this
  // works from a phone too, unlike the drag-and-drop used for reordering
  // above (which needs the up/down-button fallback instead).
  function handleResizePointerDown(e: React.PointerEvent<HTMLDivElement>) {
    e.preventDefault();
    const startX = e.clientX;
    const startWidth = cardWidthPx;
    setResizing(true);

    function handleMove(ev: PointerEvent) {
      onCardWidthChange(clampCardWidth(startWidth + (ev.clientX - startX)), false);
    }
    function handleUp(ev: PointerEvent) {
      onCardWidthChange(clampCardWidth(startWidth + (ev.clientX - startX)), true);
      setResizing(false);
      window.removeEventListener("pointermove", handleMove);
      window.removeEventListener("pointerup", handleUp);
    }

    window.addEventListener("pointermove", handleMove);
    window.addEventListener("pointerup", handleUp);
  }

  async function persistTitle(next: string) {
    const trimmed = next.trim() || "Untitled day";
    setTitleDraft(trimmed);
    const supabase = createBrowserClient();
    const { error: updateError } = await supabase
      .from("workouts")
      .update({ title: trimmed })
      .eq("id", day.id);

    if (updateError) {
      // Roll the input back to what's actually saved rather than leaving
      // the UI showing a title that never persisted.
      setTitleDraft(day.title);
      setError("Couldn't rename — try again.");
      return;
    }

    onUpdate({ title: trimmed });
  }

  async function persistOrder(items: BuilderItem[]) {
    const supabase = createBrowserClient();
    await Promise.all(
      items.map((item, i) =>
        item.kind === "exercise"
          ? supabase.from("group_workout_exercises").update({ exercise_order: i }).eq("id", item.id)
          : supabase.from("workout_notes").update({ position: i }).eq("id", item.id)
      )
    );
  }

  function handleDrop(targetId: string) {
    if (!draggedItemId || draggedItemId === targetId) {
      setDraggedItemId(null);
      return;
    }
    const items = day.items;
    const fromIndex = items.findIndex((i) => i.id === draggedItemId);
    const toIndex = items.findIndex((i) => i.id === targetId);
    if (fromIndex === -1 || toIndex === -1) {
      setDraggedItemId(null);
      return;
    }
    const next = items.slice();
    const [moved] = next.splice(fromIndex, 1);
    next.splice(toIndex, 0, moved);
    const reindexed = next.map((item, i) => ({ ...item, order: i }));
    onItemsChange(reindexed);
    persistOrder(reindexed);
    setDraggedItemId(null);
  }

  // Up/down fallback alongside the drag handle above — native HTML5
  // drag-and-drop never fires on a touchscreen, and this builder is meant
  // to be usable from a coach's phone.
  function moveItem(sortedItems: BuilderItem[], index: number, direction: -1 | 1) {
    const target = index + direction;
    if (target < 0 || target >= sortedItems.length) return;
    const next = sortedItems.slice();
    [next[index], next[target]] = [next[target], next[index]];
    const reindexed = next.map((item, i) => ({ ...item, order: i }));
    onItemsChange(reindexed);
    persistOrder(reindexed);
  }

  // Slots a duplicated item in right after its original and renumbers
  // everything else — assigning it `original.order + 1` on its own (as the
  // card that built it did) can collide with whatever already had that
  // order value, since nothing downstream gets renumbered to make room.
  function insertAfter(sourceId: string, newItem: BuilderItem) {
    const sortedItems = day.items.slice().sort((a, b) => a.order - b.order);
    const sourceIndex = sortedItems.findIndex((i) => i.id === sourceId);
    const next = sortedItems.slice();
    next.splice(sourceIndex === -1 ? next.length : sourceIndex + 1, 0, newItem);
    const reindexed = next.map((item, i) => ({ ...item, order: i }));
    onItemsChange(reindexed);
    persistOrder(reindexed);
  }

  async function handleAddExercise() {
    const supabase = createBrowserClient();
    const nextOrder = day.items.length > 0 ? Math.max(...day.items.map((i) => i.order)) + 1 : 0;

    const { data: newRow } = await supabase
      .from("group_workout_exercises")
      .insert({
        workout_id: day.id,
        group_id: groupId,
        exercise_name: "",
        exercise_order: nextOrder,
      })
      .select("id, tracked_fields")
      .single();

    if (!newRow) return;

    const { data: setRow } = await supabase
      .from("group_workout_exercise_sets")
      .insert({ group_workout_exercise_id: newRow.id, set_order: 0 })
      .select(SET_ROW_SELECT)
      .single();

    const newExercise: BuilderExercise = {
      kind: "exercise",
      id: newRow.id,
      order: nextOrder,
      exerciseName: "",
      movementPatternId: null,
      trackedFields: newRow.tracked_fields ?? DEFAULT_TRACKED_FIELDS,
      notes: null,
      videoPath: null,
      youtubeUrl: null,
      sets: setRow ? [mapSetRow(setRow)] : [],
    };

    onItemsChange([...day.items, newExercise]);
  }

  async function handleAddNote() {
    const supabase = createBrowserClient();
    const nextOrder = day.items.length > 0 ? Math.max(...day.items.map((i) => i.order)) + 1 : 0;
    const { data: userData } = await supabase.auth.getUser();
    if (!userData.user) return;

    const { data: newRow } = await supabase
      .from("workout_notes")
      .insert({
        workout_id: day.id,
        group_id: groupId,
        body: "",
        position: nextOrder,
        created_by: userData.user.id,
      })
      .select("id")
      .single();

    if (!newRow) return;

    const newNote: BuilderNote = { kind: "note", id: newRow.id, order: nextOrder, body: "" };
    onItemsChange([...day.items, newNote]);
  }

  async function handleDeleteDay() {
    if (!window.confirm(`Delete "${day.title}"? This can't be undone.`)) return;

    setBusy(true);
    setError(null);
    const supabase = createBrowserClient();
    const { error: deleteError } = await supabase.from("workouts").delete().eq("id", day.id);

    if (deleteError) {
      // athlete_sessions.workout_id is ON DELETE RESTRICT — a day athletes
      // have already logged can't be silently deleted out from under them.
      setError("Can't delete — athletes have already logged this day.");
      setBusy(false);
      return;
    }

    onDeleted();
  }

  function itemKey(item: BuilderItem) {
    return item.id;
  }

  // Collapsed to a narrow strip — a finished day parked off to the side so
  // the days still ahead don't need as much horizontal scrolling to reach.
  if (collapsed) {
    const itemCount = day.items.filter((i) => i.kind === "exercise").length;
    return (
      <button
        type="button"
        onClick={() => setCollapsed(false)}
        aria-label={`Expand ${day.title}`}
        className="shrink-0 border border-steel/20 bg-graphite flex flex-col items-center gap-2 py-3 active:bg-surface/60 transition-colors max-h-[80vh]"
        style={{ width: COLLAPSED_WIDTH }}
      >
        <Maximize2 className="w-3.5 h-3.5 text-steel shrink-0" aria-hidden="true" />
        <span
          className="font-display uppercase text-xs font-bold text-chalk [writing-mode:vertical-rl] rotate-180 truncate"
          style={{ maxHeight: "calc(80vh - 60px)" }}
        >
          {day.title}
        </span>
        <span className="font-body text-[10px] text-steel [writing-mode:vertical-rl] rotate-180 shrink-0">
          {itemCount} {itemCount === 1 ? "exercise" : "exercises"}
        </span>
      </button>
    );
  }

  return (
    <div
      className="relative shrink-0 border border-steel/20 bg-graphite flex flex-col max-h-[80vh]"
      style={{ width: cardWidthPx }}
    >
      {/* Sits in the gap between columns (not overlapping this column's own
          content/scrollbar, which a right-0 overlay handle collided with)
          so the pointer hit-target is never fought over by anything else. */}
      <div
        onPointerDown={handleResizePointerDown}
        role="separator"
        aria-orientation="vertical"
        aria-label="Drag to resize column width"
        className={`absolute top-0 bottom-0 left-full w-3 cursor-col-resize z-20 flex items-center justify-center touch-none ${
          resizing ? "bg-rust/20" : ""
        }`}
      >
        <span
          className={`w-0.5 h-8 rounded-full transition-colors ${
            resizing ? "bg-rust" : "bg-steel/40"
          }`}
        />
      </div>

      <div className="flex items-center gap-2 px-3 py-2.5 border-b border-steel/20 bg-surface/60">
        <GripVertical className="w-4 h-4 text-steel shrink-0 cursor-grab hidden sm:block" aria-hidden="true" />
        <div className="flex items-center gap-0.5 shrink-0 sm:hidden" aria-label="Reorder day">
          <button
            type="button"
            onClick={onMoveLeft}
            disabled={!canMoveLeft}
            aria-label="Move day left"
            className="w-6 h-6 flex items-center justify-center text-steel disabled:opacity-30"
          >
            <ChevronLeft className="w-3.5 h-3.5" />
          </button>
          <button
            type="button"
            onClick={onMoveRight}
            disabled={!canMoveRight}
            aria-label="Move day right"
            className="w-6 h-6 flex items-center justify-center text-steel disabled:opacity-30"
          >
            <ChevronRight className="w-3.5 h-3.5" />
          </button>
        </div>
        <div className="flex-1 min-w-0 flex flex-col">
          <input
            type="text"
            value={titleDraft}
            onChange={(e) => setTitleDraft(e.target.value)}
            onBlur={() => {
              if (titleDraft !== day.title) persistTitle(titleDraft);
            }}
            className="w-full bg-transparent border-none focus:outline-none font-display uppercase text-sm font-bold text-chalk"
          />
          {scheduledDate && (
            <span className="font-body text-[11px] text-steel">
              {formatShortDate(scheduledDate)}
            </span>
          )}
        </div>
        <Link
          href={`/groups/${groupId}/workouts/${day.id}/clients`}
          className="font-body text-[11px] text-steel active:text-rust transition-colors shrink-0"
        >
          Clients
        </Link>
        <button
          type="button"
          onClick={handleDeleteDay}
          disabled={busy}
          className="font-body text-[11px] text-steel active:text-rust transition-colors shrink-0 disabled:opacity-40"
        >
          Delete
        </button>
        <button
          type="button"
          onClick={() => setCollapsed(true)}
          aria-label="Collapse day"
          className="w-6 h-6 flex items-center justify-center text-steel active:text-rust transition-colors shrink-0"
        >
          <Minimize2 className="w-3.5 h-3.5" />
        </button>
      </div>

      {error && (
        <p className="font-body text-xs text-rust px-3 pt-2" role="alert">
          {error}
        </p>
      )}

      <div className="flex-1 overflow-y-auto p-2.5 space-y-2.5">
        {(() => {
          const sortedItems = day.items.slice().sort((a, b) => a.order - b.order);
          return sortedItems.map((item, index) => (
            <div
              key={itemKey(item)}
              draggable
              onDragStart={() => setDraggedItemId(item.id)}
              onDragEnd={() => setDraggedItemId(null)}
              onDragOver={(e) => e.preventDefault()}
              onDrop={() => handleDrop(item.id)}
              className={draggedItemId === item.id ? "opacity-50" : ""}
            >
              {item.kind === "exercise" ? (
                <ExerciseBuilderCard
                  exercise={item}
                  workoutId={day.id}
                  groupId={groupId}
                  exerciseLibrary={exerciseLibrary}
                  movementPatterns={movementPatterns}
                  canMoveUp={index > 0}
                  canMoveDown={index < sortedItems.length - 1}
                  onMoveUp={() => moveItem(sortedItems, index, -1)}
                  onMoveDown={() => moveItem(sortedItems, index, 1)}
                  onUpdate={(patch) =>
                    onItemsChange(
                      day.items.map((i) => (i.id === item.id ? { ...i, ...patch } : i))
                    )
                  }
                  onSetsChange={(sets) =>
                    onItemsChange(
                      day.items.map((i) => (i.id === item.id && i.kind === "exercise" ? { ...i, sets } : i))
                    )
                  }
                  onDeleted={() => onItemsChange(day.items.filter((i) => i.id !== item.id))}
                  onDuplicated={(newExercise) => insertAfter(item.id, newExercise)}
                />
              ) : (
                <TextNoteCard
                  noteId={item.id}
                  initialBody={item.body}
                  canMoveUp={index > 0}
                  canMoveDown={index < sortedItems.length - 1}
                  onMoveUp={() => moveItem(sortedItems, index, -1)}
                  onMoveDown={() => moveItem(sortedItems, index, 1)}
                  onDeleted={() => onItemsChange(day.items.filter((i) => i.id !== item.id))}
                />
              )}
            </div>
          ));
        })()}
      </div>

      <div className="flex items-center gap-2 px-2.5 py-2 border-t border-steel/20">
        <button
          type="button"
          onClick={handleAddExercise}
          className="flex-1 h-9 border border-steel/30 text-steel font-body text-xs active:border-rust active:text-rust transition-colors"
        >
          + Exercise
        </button>
        <button
          type="button"
          onClick={handleAddNote}
          className="h-9 px-3 border border-steel/30 text-steel font-body text-xs active:border-rust active:text-rust transition-colors"
        >
          + Note
        </button>
      </div>
    </div>
  );
}
