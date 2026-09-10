"use client";

import { useRef, useState } from "react";
import Link from "next/link";
import { createBrowserClient } from "@/lib/supabase/client";
import type { BuilderDay, BuilderItem, BuilderExercise, BuilderNote } from "@/lib/types";
import {
  DEFAULT_TRACKED_FIELDS,
  SET_ROW_SELECT,
  mapSetRow,
  TARGET_PROP,
  formatCondensedSets,
  type TrackedField,
} from "@/lib/exercise-fields";
import { parseQuickEntry } from "@/lib/quick-entry";
import { matchExercise } from "@/lib/exercise-matching";
import { ExerciseBuilderCard, type MovementPatternOption } from "../exercise-builder-card";
import { TextNoteCard } from "../text-note-card";
import { BulkEditDayPanel } from "./bulk-edit-day-panel";
import { formatShortDate } from "@/lib/program-schedule";
import { GripVertical, ChevronDown, ChevronUp } from "lucide-react";
import { flashSaved, flashSaveError } from "@/lib/save-toast";

// Quick-add is typed fast, so a bare "Bench" for an existing "Bench
// Press" is common — matchExercise's fuzzy threshold is deliberately
// conservative (avoids merging genuinely different exercises that share
// a word, e.g. "Barbell Bench Press" vs "Barbell Overhead Press"), which
// means a short real prefix like that doesn't cross it. This adds one
// narrower, safe fallback specifically for quick-add: if exactly one
// library exercise starts with what was typed, reuse it — never applied
// when it's ambiguous between two or more candidates.
function resolveQuickAddExerciseName(typedName: string, library: string[]): string {
  const match = matchExercise(typedName, library.map((name) => ({ name })), []);
  if (match.exerciseName) return match.exerciseName;

  const normalizedTyped = typedName.trim().toLowerCase();
  const prefixMatches = library.filter((name) => name.toLowerCase().startsWith(normalizedTyped));
  return prefixMatches.length === 1 ? prefixMatches[0] : typedName;
}

export function DayCard({
  day,
  scheduledDate,
  groupId,
  exerciseLibrary,
  movementPatterns,
  condensed = false,
  onUpdate,
  onItemsChange,
  onDeleted,
}: {
  day: BuilderDay;
  scheduledDate?: Date;
  groupId: string;
  exerciseLibrary: string[];
  movementPatterns: MovementPatternOption[];
  // Week-level "Collapse days" toggle — shows each exercise as one
  // condensed line (name + sets×reps) instead of the full editable grid.
  // Distinct from the day's own header chevron below, which hides the
  // exercise list entirely.
  condensed?: boolean;
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
  // Guards handleAddExercise/handleAddNote against a real race: both
  // compute the next order off the `day.items` closure, stale until the
  // parent re-renders with the new array. A fast double-click on
  // "+ Exercise"/"+ Note" would otherwise insert two rows at the same
  // order (found and fixed for the analogous per-set bug tonight).
  const [addItemBusy, setAddItemBusy] = useState(false);
  // Keyboard-only shorthand for building out a day fast — "Bench 3x5 @7",
  // Enter, and it's added as a real exercise with real sets; the input
  // stays focused so the coach can immediately type the next one without
  // ever reaching for the mouse.
  const [quickEntryDraft, setQuickEntryDraft] = useState("");
  const [quickEntryError, setQuickEntryError] = useState<string | null>(null);
  const quickEntryRef = useRef<HTMLInputElement>(null);

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
    flashSaved();
  }

  async function persistOrder(items: BuilderItem[]) {
    const supabase = createBrowserClient();
    const results = await Promise.all(
      items.map((item, i) =>
        item.kind === "exercise"
          ? supabase.from("group_workout_exercises").update({ exercise_order: i }).eq("id", item.id)
          : supabase.from("workout_notes").update({ position: i }).eq("id", item.id)
      )
    );
    if (results.some((r) => r.error)) {
      flashSaveError("Couldn't save the new order — reload to check.");
      return;
    }
    flashSaved();
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
    if (addItemBusy) return;
    setAddItemBusy(true);
    try {
      const supabase = createBrowserClient();
      const nextOrder = day.items.length > 0 ? Math.max(...day.items.map((i) => i.order)) + 1 : 0;

      const { data: newRow, error: insertError } = await supabase
        .from("group_workout_exercises")
        .insert({
          workout_id: day.id,
          group_id: groupId,
          exercise_name: "",
          exercise_order: nextOrder,
        })
        .select("id, tracked_fields")
        .single();

      if (insertError || !newRow) {
        flashSaveError("Couldn't add that exercise — try again.");
        return;
      }

      const { data: setRow, error: setInsertError } = await supabase
        .from("group_workout_exercise_sets")
        .insert({ group_workout_exercise_id: newRow.id, set_order: 0 })
        .select(SET_ROW_SELECT)
        .single();

      if (setInsertError) {
        flashSaveError("Exercise added, but its first set didn't save — try adding one manually.");
      }

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
      if (!setInsertError) flashSaved();
    } finally {
      setAddItemBusy(false);
    }
  }

  async function handleAddNote() {
    if (addItemBusy) return;
    setAddItemBusy(true);
    try {
      const supabase = createBrowserClient();
      const nextOrder = day.items.length > 0 ? Math.max(...day.items.map((i) => i.order)) + 1 : 0;
      const { data: userData } = await supabase.auth.getUser();
      if (!userData.user) return;

      const { data: newRow, error: insertError } = await supabase
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

      if (insertError || !newRow) {
        flashSaveError("Couldn't add that note — try again.");
        return;
      }

      const newNote: BuilderNote = { kind: "note", id: newRow.id, order: nextOrder, body: "" };
      onItemsChange([...day.items, newNote]);
      flashSaved();
    } finally {
      setAddItemBusy(false);
    }
  }

  async function handleQuickAdd() {
    const parsed = parseQuickEntry(quickEntryDraft);
    if (!parsed) {
      setQuickEntryError('Try "Exercise 3x8" or "Exercise 3x8 @7"');
      return;
    }
    if (addItemBusy) return;
    setAddItemBusy(true);
    setQuickEntryError(null);
    try {
      const supabase = createBrowserClient();
      const nextOrder = day.items.length > 0 ? Math.max(...day.items.map((i) => i.order)) + 1 : 0;

      const resolvedExerciseName = resolveQuickAddExerciseName(parsed.exerciseName, exerciseLibrary);

      const { data: newRow, error: insertError } = await supabase
        .from("group_workout_exercises")
        .insert({
          workout_id: day.id,
          group_id: groupId,
          exercise_name: resolvedExerciseName,
          exercise_order: nextOrder,
        })
        .select("id, tracked_fields")
        .single();

      if (insertError || !newRow) {
        flashSaveError("Couldn't add that exercise — try again.");
        return;
      }

      const setsPayload = Array.from({ length: parsed.sets }, (_, i) => ({
        group_workout_exercise_id: newRow.id,
        set_order: i,
        target_reps: parsed.reps,
        target_rpe: parsed.rpe,
      }));

      const { data: setsData, error: setsError } = await supabase
        .from("group_workout_exercise_sets")
        .insert(setsPayload)
        .select(SET_ROW_SELECT);

      if (setsError) {
        flashSaveError("Exercise added, but its sets didn't save — try adding them manually.");
      }

      const newExercise: BuilderExercise = {
        kind: "exercise",
        id: newRow.id,
        order: nextOrder,
        exerciseName: resolvedExerciseName,
        movementPatternId: null,
        trackedFields: newRow.tracked_fields ?? DEFAULT_TRACKED_FIELDS,
        notes: null,
        videoPath: null,
        youtubeUrl: null,
        tier: null,
        sets: (setsData ?? []).map(mapSetRow),
      };

      onItemsChange([...day.items, newExercise]);
      setQuickEntryDraft("");
      if (!setsError) flashSaved();
    } finally {
      setAddItemBusy(false);
      // Refocus so a coach can immediately type the next exercise — the
      // entire point of this being keyboard-only.
      quickEntryRef.current?.focus();
    }
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
        <div className="px-3 pt-3">
          <input
            ref={quickEntryRef}
            type="text"
            value={quickEntryDraft}
            onChange={(e) => {
              setQuickEntryDraft(e.target.value);
              if (quickEntryError) setQuickEntryError(null);
            }}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                handleQuickAdd();
              }
            }}
            disabled={addItemBusy}
            placeholder='Quick add — "Bench 3x5 @7", Enter'
            className="w-full h-9 bg-graphite border border-steel/30 text-chalk px-3 font-body text-sm focus:outline-none focus:border-rust disabled:opacity-50"
          />
          {quickEntryError && (
            <p className="font-body text-[11px] text-rust mt-1">{quickEntryError}</p>
          )}
        </div>
      )}

      {!collapsed && condensed && (
        <div className="flex-1 p-3">
          {(() => {
            const sortedItems = day.items.slice().sort((a, b) => a.order - b.order);
            if (sortedItems.length === 0) {
              return <p className="font-body text-xs text-steel py-1">No exercises yet.</p>;
            }
            return (
              <div className="divide-y divide-steel/15">
                {sortedItems.map((item) =>
                  item.kind === "exercise" ? (
                    <div key={item.id} className="py-2 flex items-center justify-between gap-2">
                      <span className="font-body text-sm truncate">
                        {item.exerciseName || "Untitled exercise"}
                      </span>
                      <span className="font-body text-xs text-steel shrink-0">
                        {formatCondensedSets(item.sets, item.trackedFields)}
                      </span>
                    </div>
                  ) : (
                    <div key={item.id} className="py-2">
                      <span className="font-body text-xs text-steel italic truncate block">
                        {item.body || "Note"}
                      </span>
                    </div>
                  )
                )}
              </div>
            );
          })()}
        </div>
      )}

      {!collapsed && !condensed && (
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
                      // A patch and a full sets replacement made back-to-back in
                      // the same handler (e.g. removing a tracked field, or
                      // applying a cardio preset) would otherwise race: both
                      // onUpdate and onSetsChange close over this same render's
                      // `day.items`, so the second call always overwrites the
                      // first's change instead of composing with it — found
                      // live while verifying the Energy System preset (set
                      // count updated, but tracked_fields visibly reverted).
                      // This single combined callback computes both fields in
                      // one map pass instead of two sequential ones.
                      onFieldsAndSetsChange={(trackedFields, sets) =>
                        onItemsChange(
                          day.items.map((i) =>
                            i.id === item.id && i.kind === "exercise" ? { ...i, trackedFields, sets } : i
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
              disabled={addItemBusy}
              className="flex-1 h-9 border border-steel/30 text-steel font-body text-xs active:border-rust active:text-rust transition-colors disabled:opacity-40"
            >
              + Exercise
            </button>
            <button
              type="button"
              onClick={handleAddNote}
              disabled={addItemBusy}
              className="h-9 px-3 border border-steel/30 text-steel font-body text-xs active:border-rust active:text-rust transition-colors disabled:opacity-40"
            >
              + Note
            </button>
          </div>
        </>
      )}
    </div>
  );
}
