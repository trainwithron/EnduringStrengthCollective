"use client";

import { useState } from "react";
import { createBrowserClient } from "@/lib/supabase/client";
import { ExerciseNameInput } from "./exercise-name-input";
import { ExerciseMediaPicker } from "./exercise-media-picker";
import type { BuilderExercise, ExerciseSetTarget } from "@/lib/types";
import {
  TRACKED_FIELD_DEFS,
  TARGET_COLUMN,
  TARGET_PROP,
  SET_ROW_SELECT,
  mapSetRow,
  orderTrackedFields,
  fieldDef,
  type TrackedField,
} from "@/lib/exercise-fields";
import { ChevronDown, ChevronUp, Copy, GripVertical, Trash2 } from "lucide-react";

export interface MovementPatternOption {
  id: string;
  name: string;
}

function TargetCell({
  value,
  kind,
  onCommit,
}: {
  value: string;
  kind: "number" | "text";
  onCommit: (raw: string) => void;
}) {
  const [draft, setDraft] = useState(value);
  return (
    <input
      type={kind === "number" ? "number" : "text"}
      inputMode={kind === "number" ? "decimal" : undefined}
      value={draft}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={() => {
        if (draft !== value) onCommit(draft);
      }}
      className="w-12 h-9 bg-graphite border border-steel/30 text-chalk px-1 font-body text-xs text-center focus:outline-none focus:border-rust shrink-0"
    />
  );
}

function targetValue(set: ExerciseSetTarget, field: TrackedField): string {
  const prop = TARGET_PROP[field] as keyof ExerciseSetTarget;
  const v = set[prop];
  return v === null || v === undefined ? "" : String(v);
}

export function ExerciseBuilderCard({
  exercise,
  workoutId,
  groupId,
  exerciseLibrary,
  movementPatterns,
  canMoveUp,
  canMoveDown,
  onMoveUp,
  onMoveDown,
  onUpdate,
  onSetsChange,
  onDeleted,
  onDuplicated,
}: {
  exercise: BuilderExercise;
  workoutId: string;
  groupId: string;
  exerciseLibrary: string[];
  movementPatterns: MovementPatternOption[];
  canMoveUp: boolean;
  canMoveDown: boolean;
  onMoveUp: () => void;
  onMoveDown: () => void;
  onUpdate: (patch: Partial<Omit<BuilderExercise, "kind" | "id" | "order" | "sets">>) => void;
  onSetsChange: (sets: ExerciseSetTarget[]) => void;
  onDeleted: () => void;
  onDuplicated: (newExercise: BuilderExercise) => void;
}) {
  const [nameDraft, setNameDraft] = useState(exercise.exerciseName);
  const [collapsed, setCollapsed] = useState(false);
  const [showDetails, setShowDetails] = useState(false);
  const [addFieldOpen, setAddFieldOpen] = useState(false);
  const [notesDraft, setNotesDraft] = useState(exercise.notes ?? "");
  const [busy, setBusy] = useState(false);

  async function handleNameCommit(name: string) {
    const trimmed = name.trim();
    if (!trimmed || trimmed === exercise.exerciseName) return;
    const supabase = createBrowserClient();
    await supabase.from("group_workout_exercises").update({ exercise_name: trimmed }).eq("id", exercise.id);
    onUpdate({ exerciseName: trimmed });

    const { data: userData } = await supabase.auth.getUser();
    if (userData.user) {
      await supabase
        .from("exercise_library")
        .upsert(
          { created_by: userData.user.id, name: trimmed },
          { onConflict: "created_by,name", ignoreDuplicates: true }
        );
    }
  }

  async function handleMovementPatternChange(value: string) {
    const patternId = value || null;
    const supabase = createBrowserClient();
    await supabase.from("group_workout_exercises").update({ movement_pattern_id: patternId }).eq("id", exercise.id);
    onUpdate({ movementPatternId: patternId });
  }

  function handleMediaChange(patch: { videoPath?: string | null; youtubeUrl?: string | null }) {
    onUpdate(patch);
  }

  async function persistNotes(next: string) {
    const supabase = createBrowserClient();
    const value = next.trim() || null;
    await supabase.from("group_workout_exercises").update({ notes: value }).eq("id", exercise.id);
    onUpdate({ notes: value });
  }

  async function handleAddSet() {
    const supabase = createBrowserClient();
    const nextOrder = exercise.sets.length > 0 ? Math.max(...exercise.sets.map((s) => s.setOrder)) + 1 : 0;
    const last = exercise.sets[exercise.sets.length - 1];

    const { data } = await supabase
      .from("group_workout_exercise_sets")
      .insert({
        group_workout_exercise_id: exercise.id,
        set_order: nextOrder,
        target_reps: last?.targetReps ?? null,
        target_weight: last?.targetWeight ?? null,
        target_rpe: last?.targetRpe ?? null,
        target_rir: last?.targetRir ?? null,
        target_tempo: last?.targetTempo ?? null,
        target_time_seconds: last?.targetTimeSeconds ?? null,
        target_height: last?.targetHeight ?? null,
        target_distance: last?.targetDistance ?? null,
      })
      .select(SET_ROW_SELECT)
      .single();

    if (data) {
      onSetsChange([...exercise.sets, mapSetRow(data)]);
    }
  }

  async function handleRemoveSet() {
    if (exercise.sets.length <= 1) return;
    const last = exercise.sets[exercise.sets.length - 1];
    const supabase = createBrowserClient();
    await supabase.from("group_workout_exercise_sets").delete().eq("id", last.id);
    onSetsChange(exercise.sets.slice(0, -1));
  }

  async function handleCellCommit(setId: string, field: TrackedField, raw: string) {
    const def = fieldDef(field);
    const value = def.kind === "number" ? (raw.trim() === "" ? null : Number(raw)) : raw.trim() || null;
    const supabase = createBrowserClient();
    await supabase
      .from("group_workout_exercise_sets")
      .update({ [TARGET_COLUMN[field]]: value })
      .eq("id", setId);
    onSetsChange(
      exercise.sets.map((s) => (s.id === setId ? { ...s, [TARGET_PROP[field]]: value } : s))
    );
  }

  async function handleAddField(field: TrackedField) {
    const nextFields = orderTrackedFields([...exercise.trackedFields, field]);
    const supabase = createBrowserClient();
    await supabase.from("group_workout_exercises").update({ tracked_fields: nextFields }).eq("id", exercise.id);
    onUpdate({ trackedFields: nextFields });
    setAddFieldOpen(false);
  }

  async function handleRemoveField(field: TrackedField) {
    const nextFields = exercise.trackedFields.filter((f) => f !== field);
    const supabase = createBrowserClient();
    await supabase.from("group_workout_exercises").update({ tracked_fields: nextFields }).eq("id", exercise.id);
    const setIds = exercise.sets.map((s) => s.id);
    if (setIds.length > 0) {
      await supabase
        .from("group_workout_exercise_sets")
        .update({ [TARGET_COLUMN[field]]: null })
        .in("id", setIds);
    }
    onUpdate({ trackedFields: nextFields });
    onSetsChange(exercise.sets.map((s) => ({ ...s, [TARGET_PROP[field]]: null })));
  }

  async function handleDelete() {
    const label = exercise.exerciseName.trim() || "this exercise";
    if (!window.confirm(`Delete ${label}? This removes its sets, notes, and video. Can't be undone.`)) {
      return;
    }
    setBusy(true);
    const supabase = createBrowserClient();
    await supabase.from("group_workout_exercises").delete().eq("id", exercise.id);
    onDeleted();
  }

  async function handleDuplicate() {
    setBusy(true);
    const supabase = createBrowserClient();
    const { data: newRow } = await supabase
      .from("group_workout_exercises")
      .insert({
        workout_id: workoutId,
        group_id: groupId,
        exercise_name: exercise.exerciseName,
        exercise_order: exercise.order,
        movement_pattern_id: exercise.movementPatternId,
        tracked_fields: exercise.trackedFields,
        notes: exercise.notes,
      })
      .select("id")
      .single();

    if (!newRow) {
      setBusy(false);
      return;
    }

    let newSets: ExerciseSetTarget[] = [];
    if (exercise.sets.length > 0) {
      const { data: setsData } = await supabase
        .from("group_workout_exercise_sets")
        .insert(
          exercise.sets.map((s) => ({
            group_workout_exercise_id: newRow.id,
            set_order: s.setOrder,
            target_reps: s.targetReps,
            target_weight: s.targetWeight,
            target_rpe: s.targetRpe,
            target_rir: s.targetRir,
            target_tempo: s.targetTempo,
            target_time_seconds: s.targetTimeSeconds,
            target_height: s.targetHeight,
            target_distance: s.targetDistance,
          }))
        )
        .select(SET_ROW_SELECT);
      newSets = (setsData ?? []).map(mapSetRow);
    }

    onDuplicated({
      kind: "exercise",
      id: newRow.id,
      order: exercise.order + 1,
      exerciseName: exercise.exerciseName,
      movementPatternId: exercise.movementPatternId,
      trackedFields: exercise.trackedFields,
      notes: exercise.notes,
      videoPath: exercise.videoPath,
      youtubeUrl: exercise.youtubeUrl,
      sets: newSets,
    });
    setBusy(false);
  }

  const untrackedFields = TRACKED_FIELD_DEFS.map((f) => f.key).filter(
    (k) => !exercise.trackedFields.includes(k)
  );

  return (
    <div className="border border-steel/20 p-3 bg-surface/40">
      <div className="flex items-center gap-2 mb-2">
        <GripVertical className="w-4 h-4 text-steel shrink-0 hidden sm:block" aria-hidden="true" />
        <div className="flex items-center gap-0.5 shrink-0 sm:hidden" aria-label="Reorder exercise">
          <button
            type="button"
            onClick={onMoveUp}
            disabled={!canMoveUp}
            aria-label="Move exercise up"
            className="w-6 h-7 flex items-center justify-center text-steel disabled:opacity-30"
          >
            <ChevronUp className="w-3.5 h-3.5" />
          </button>
          <button
            type="button"
            onClick={onMoveDown}
            disabled={!canMoveDown}
            aria-label="Move exercise down"
            className="w-6 h-7 flex items-center justify-center text-steel disabled:opacity-30"
          >
            <ChevronDown className="w-3.5 h-3.5" />
          </button>
        </div>
        <div className="flex-1 min-w-0">
          <ExerciseNameInput
            value={collapsed ? exercise.exerciseName : nameDraft}
            onChange={setNameDraft}
            onCommit={handleNameCommit}
            suggestions={exerciseLibrary}
          />
        </div>
        <button
          type="button"
          onClick={() => setCollapsed((v) => !v)}
          aria-label={collapsed ? "Expand exercise" : "Collapse exercise"}
          className="w-7 h-7 flex items-center justify-center text-steel shrink-0"
        >
          {collapsed ? <ChevronDown className="w-4 h-4" /> : <ChevronUp className="w-4 h-4" />}
        </button>
        <button
          type="button"
          onClick={handleDuplicate}
          disabled={busy}
          aria-label="Duplicate exercise"
          className="w-7 h-7 flex items-center justify-center text-steel active:text-rust transition-colors shrink-0 disabled:opacity-40"
        >
          <Copy className="w-3.5 h-3.5" />
        </button>
        <button
          type="button"
          onClick={handleDelete}
          disabled={busy}
          aria-label="Delete exercise"
          className="w-7 h-7 flex items-center justify-center text-steel active:text-rust transition-colors shrink-0 disabled:opacity-40"
        >
          <Trash2 className="w-3.5 h-3.5" />
        </button>
      </div>

      {!collapsed && (
        <>
          {movementPatterns.length > 0 && (
            <select
              value={exercise.movementPatternId ?? ""}
              onChange={(e) => handleMovementPatternChange(e.target.value)}
              className="w-full h-9 mb-2 bg-graphite border border-steel/30 text-chalk px-2 font-body text-xs focus:outline-none focus:border-rust"
            >
              <option value="">No movement pattern</option>
              {movementPatterns.map((mp) => (
                <option key={mp.id} value={mp.id}>
                  {mp.name}
                </option>
              ))}
            </select>
          )}

          <div className="flex items-center gap-2 mb-2">
            <button
              type="button"
              onClick={handleRemoveSet}
              disabled={exercise.sets.length <= 1}
              className="w-7 h-7 flex items-center justify-center border border-steel/30 text-steel disabled:opacity-30"
            >
              −
            </button>
            <span className="font-body text-xs text-steel">{exercise.sets.length} sets</span>
            <button
              type="button"
              onClick={handleAddSet}
              className="w-7 h-7 flex items-center justify-center border border-steel/30 text-steel active:border-rust active:text-rust"
            >
              +
            </button>
          </div>

          <div className="overflow-x-auto">
            <div className="space-y-1.5 min-w-fit">
              {orderTrackedFields(exercise.trackedFields).map((field) => {
                const def = fieldDef(field);
                return (
                  <div key={field} className="flex items-center gap-1.5">
                    <span className="w-14 shrink-0 font-body text-[10px] text-steel uppercase tracking-wide">
                      {def.label}
                    </span>
                    {exercise.sets.map((set) => (
                      <TargetCell
                        key={set.id}
                        value={targetValue(set, field)}
                        kind={def.kind}
                        onCommit={(raw) => handleCellCommit(set.id, field, raw)}
                      />
                    ))}
                    <button
                      type="button"
                      onClick={() => handleRemoveField(field)}
                      aria-label={`Stop tracking ${def.label}`}
                      className="w-6 h-9 flex items-center justify-center text-steel/60 active:text-rust shrink-0"
                    >
                      ×
                    </button>
                  </div>
                );
              })}
            </div>
          </div>

          <div className="relative mt-1.5">
            <button
              type="button"
              onClick={() => setAddFieldOpen((v) => !v)}
              disabled={untrackedFields.length === 0}
              className="font-body text-xs text-steel active:text-rust transition-colors disabled:opacity-30"
            >
              + Add
            </button>
            {addFieldOpen && untrackedFields.length > 0 && (
              <div className="absolute z-10 left-0 mt-1 bg-surface border border-steel/30 flex flex-wrap gap-1 p-1.5 w-48">
                {untrackedFields.map((f) => (
                  <button
                    key={f}
                    type="button"
                    onClick={() => handleAddField(f)}
                    className="h-7 px-2 border border-steel/30 text-steel font-body text-xs active:border-rust active:text-rust"
                  >
                    {fieldDef(f).label}
                  </button>
                ))}
              </div>
            )}
          </div>

          <button
            type="button"
            onClick={() => setShowDetails((v) => !v)}
            className="mt-2 font-body text-xs text-steel active:text-rust transition-colors block"
          >
            {showDetails ? "Hide details" : "Edit details"}
          </button>

          {showDetails && (
            <div className="mt-2 pt-2 border-t border-steel/15 space-y-2">
              <textarea
                value={notesDraft}
                onChange={(e) => setNotesDraft(e.target.value)}
                onBlur={() => {
                  if (notesDraft !== (exercise.notes ?? "")) persistNotes(notesDraft);
                }}
                placeholder="Notes for this exercise (cues, setup, etc.)"
                rows={2}
                className="w-full bg-graphite border border-steel/30 text-chalk px-2 py-1.5 font-body text-xs focus:outline-none focus:border-rust resize-none"
              />
              <ExerciseMediaPicker
                exerciseName={exercise.exerciseName}
                videoPath={exercise.videoPath}
                youtubeUrl={exercise.youtubeUrl}
                onChange={handleMediaChange}
              />
            </div>
          )}
        </>
      )}
    </div>
  );
}
