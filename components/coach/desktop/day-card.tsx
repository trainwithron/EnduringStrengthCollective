"use client";

import { useState } from "react";
import Link from "next/link";
import { createBrowserClient } from "@/lib/supabase/client";
import type { BuilderDay, BuilderItem, BuilderExercise, BuilderNote } from "@/lib/types";
import {
  DEFAULT_TRACKED_FIELDS,
  SET_ROW_SELECT,
  mapSetRow,
  TARGET_PROP,
  type TrackedField,
} from "@/lib/exercise-fields";
import { ExerciseBuilderCard, type MovementPatternOption } from "../exercise-builder-card";
import { TextNoteCard } from "../text-note-card";
import { BulkEditDayPanel } from "./bulk-edit-day-panel";
import { formatShortDate } from "@/lib/program-schedule";
import { GripVertical, ChevronDown, ChevronUp } from "lucide-react";

export function DayCard({
  day,
  scheduledDate,
  groupId,
  exerciseLibrary,
  movementPatterns,
  onUpdate,
  onItemsChange,
  onDeleted,
}: {
  day: BuilderDay;
  scheduledDate?: Date;
  groupId: string;
  exerciseLibrary: string[];
  movementPatterns: MovementPatternOption[];
  onUpdate: (patch: Partial<Pick<BuilderDay, "title">>) => void;
  onItemsChange: (items: BuilderItem[]) => void;
  onDeleted: () => void;
}) {
  const [titleDraft, setTitleDraft] = useState(day.title);
  const [draggedItemId, setDraggedItemId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Desktop has room to spare, so collapse just hides the exercise list
  // instead of shrinking to a vertical strip (that was built specifically
  // for cramped mobile horizontal scrolling).
  const [collapsed, setCollapsed] = useState(false);

  async function persistTitle(next: string) {
    const trimmed = next.trim() || "Untitled day";
    setTitleDraft(trimmed);
    const supabase = createBrowserClient();
    const { error: updateError } = await supabase
      .from("workouts")
      .update({ title: trimmed })
      .eq("id", day.id);

    if (updateError) {
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

  function moveItem(sortedItems: BuilderItem[], index: number, direction: -1 | 1) {
    const target = index + direction;
    if (target < 0 || target >= sortedItems.length) return;
    const next = sortedItems.slice();
    [next[index], next[target]] = [next[target], next[index]];
    const reindexed = next.map((item, i) => ({ ...item, order: i }));
    onItemsChange(reindexed);
    persistOrder(reindexed);
  }

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
      tier: null,
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
    if (
      !window.confirm(
        `Delete "${day.title}"? This can't be undone. Any client who already logged this workout keeps that history — this only removes the template.`
      )
    ) {
      return;
    }

    setBusy(true);
    setError(null);
    const supabase = createBrowserClient();
    const { error: deleteError } = await supabase.from("workouts").delete().eq("id", day.id);

    if (deleteError) {
      setError("Couldn't delete — try again.");
      setBusy(false);
      return;
    }

    onDeleted();
  }

  const itemCount = day.items.filter((i) => i.kind === "exercise").length;
  const dayExercises = day.items.filter((i): i is BuilderExercise => i.kind === "exercise");

  function handleBulkApplied(
    updates: { exerciseId: string; field: TrackedField; value: string | number | null }[]
  ) {
    const byExercise = new Map(updates.map((u) => [u.exerciseId, u]));
    onItemsChange(
      day.items.map((item) => {
        if (item.kind !== "exercise") return item;
        const update = byExercise.get(item.id);
        if (!update) return item;
        const prop = TARGET_PROP[update.field] as keyof BuilderExercise["sets"][number];
        return { ...item, sets: item.sets.map((s) => ({ ...s, [prop]: update.value })) };
      })
    );
  }

  return (
    <div className="border border-steel/20 bg-surface/40 flex flex-col">
      <div className="flex items-center gap-2 px-4 py-3 border-b border-steel/20 bg-surface">
        <GripVertical className="w-4 h-4 text-steel shrink-0 cursor-grab" aria-hidden="true" />
        <div className="flex-1 min-w-0 flex flex-col">
          <input
            type="text"
            value={titleDraft}
            onChange={(e) => setTitleDraft(e.target.value)}
            onBlur={() => {
              if (titleDraft !== day.title) persistTitle(titleDraft);
            }}
            className="w-full bg-transparent border-none focus:outline-none font-display uppercase text-base font-bold text-chalk"
          />
          {scheduledDate && (
            <span className="font-body text-xs text-steel">{formatShortDate(scheduledDate)}</span>
          )}
        </div>
        <span className="font-body text-xs text-steel shrink-0">
          {itemCount} {itemCount === 1 ? "exercise" : "exercises"}
        </span>
        <Link
          href={`/groups/${groupId}/workouts/${day.id}/clients`}
          className="font-body text-xs text-steel active:text-rust transition-colors shrink-0"
        >
          Clients
        </Link>
        <button
          type="button"
          onClick={handleDeleteDay}
          disabled={busy}
          className="font-body text-xs text-steel active:text-rust transition-colors shrink-0 disabled:opacity-40"
        >
          Delete
        </button>
        <button
          type="button"
          onClick={() => setCollapsed((v) => !v)}
          aria-label={collapsed ? "Expand day" : "Collapse day"}
          className="w-6 h-6 flex items-center justify-center text-steel active:text-rust transition-colors shrink-0"
        >
          {collapsed ? <ChevronDown className="w-4 h-4" /> : <ChevronUp className="w-4 h-4" />}
        </button>
      </div>

      {error && (
        <p className="font-body text-xs text-rust px-4 pt-2" role="alert">
          {error}
        </p>
      )}

      {!collapsed && (
        <>
          {dayExercises.length > 1 && (
            <div className="px-3 pt-3">
              <BulkEditDayPanel
                exercises={dayExercises}
                onApplied={handleBulkApplied}
                label="Bulk edit day"
              />
            </div>
          )}

          <div className="flex-1 p-3 space-y-3">
            {(() => {
              const sortedItems = day.items.slice().sort((a, b) => a.order - b.order);
              return sortedItems.map((item, index) => (
                <div
                  key={item.id}
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
                        onItemsChange(day.items.map((i) => (i.id === item.id ? { ...i, ...patch } : i)))
                      }
                      onSetsChange={(sets) =>
                        onItemsChange(
                          day.items.map((i) =>
                            i.id === item.id && i.kind === "exercise" ? { ...i, sets } : i
                          )
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

          <div className="flex items-center gap-2 px-3 py-2.5 border-t border-steel/20">
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
        </>
      )}
    </div>
  );
}
