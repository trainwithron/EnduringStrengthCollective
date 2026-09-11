"use client";

import { useState } from "react";
import { createBrowserClient } from "@/lib/supabase/client";
import type { SessionExerciseEntry, SetLogEntry } from "@/lib/types";
import { TRACKED_FIELD_DEFS, ACTUAL_COLUMN, ACTUAL_PROP, fieldDef, type TrackedField } from "@/lib/exercise-fields";
import { SetRow } from "./set-row";
import { ExerciseVideoThread } from "./exercise-video-thread";

export function ExerciseCard({
  exercise,
  lastTime,
  ladder,
  readOnly,
  onSetChange,
  onSetAdded,
  onRenamed,
  onTrackedFieldsChange,
  onDelete,
  deleting,
  sessionId,
  groupId,
  athleteId,
  viewerId,
  canUpload,
  onSetCompleted,
}: {
  exercise: SessionExerciseEntry;
  lastTime?: { weight: number; reps: number };
  ladder?: string[];
  readOnly: boolean;
  onSetChange: (setId: string, patch: Partial<SetLogEntry>) => void;
  onSetAdded: (set: SetLogEntry) => void;
  onRenamed: (name: string) => void;
  onTrackedFieldsChange: (fields: TrackedField[]) => void;
  onDelete?: () => void;
  deleting?: boolean;
  sessionId: string;
  groupId: string;
  athleteId: string;
  viewerId: string | null;
  canUpload: boolean;
  onSetCompleted?: (set: SetLogEntry) => void;
}) {
  const [swapping, setSwapping] = useState(false);
  const [nameDraft, setNameDraft] = useState(exercise.exerciseName);
  const [swapBusy, setSwapBusy] = useState(false);
  const [swapError, setSwapError] = useState<string | null>(null);
  // Guards handleAddSet against a real race: it computes set_order off the
  // `exercise.sets` closure, stale until the parent re-renders with the new
  // array. A fast double-tap on "+ set" mid-workout would otherwise insert
  // two set_logs rows with the same set_order (found and fixed for the
  // coach-builder equivalent of this same bug tonight).
  const [addSetBusy, setAddSetBusy] = useState(false);
  const [fieldsOpen, setFieldsOpen] = useState(false);
  const [fieldsBusy, setFieldsBusy] = useState(false);

  async function applySwap(name: string) {
    if (!name || name === exercise.exerciseName) {
      setSwapping(false);
      return;
    }
    setSwapBusy(true);
    setSwapError(null);
    const supabase = createBrowserClient();
    const { error } = await supabase
      .from("session_exercises")
      .update({ exercise_name: name, is_swapped: true })
      .eq("id", exercise.id);

    setSwapBusy(false);
    // Only reflect the swap in the UI once it's actually saved — otherwise
    // a failed write would show the new exercise name while the database
    // still has the old one, with no way to tell the two apart.
    if (error) {
      setSwapError("Couldn't swap — check your connection and try again.");
      return;
    }
    onRenamed(name);
    setSwapping(false);
  }

  async function handleAddSet() {
    if (addSetBusy) return;
    setAddSetBusy(true);
    try {
      const supabase = createBrowserClient();
      const nextOrder =
        exercise.sets.length > 0 ? Math.max(...exercise.sets.map((s) => s.setOrder)) + 1 : 0;

      const { data: set } = await supabase
        .from("set_logs")
        .insert({ session_exercise_id: exercise.id, set_order: nextOrder })
        .select("id, set_order, weight, reps, rpe, rir, tempo, time_seconds, height, distance, rest_seconds, pace, status")
        .single();

      if (set) {
        onSetAdded({
          id: set.id,
          setOrder: set.set_order,
          weight: set.weight,
          reps: set.reps,
          rpe: set.rpe,
          rir: set.rir,
          tempo: set.tempo,
          timeSeconds: set.time_seconds,
          height: set.height,
          distance: set.distance,
          restSeconds: set.rest_seconds,
          pace: set.pace,
          status: set.status,
        });
      }
    } finally {
      setAddSetBusy(false);
    }
  }

  // Which metrics this exercise actually tracks is a per-session-instance
  // choice, not fixed by the program template — a coach standing there
  // in person needs to add "distance" for a sprint drill someone swapped
  // in, or drop RPE for an exercise it never made sense for, without
  // leaving the log screen to go edit the program builder.
  async function handleAddField(field: TrackedField) {
    if (fieldsBusy) return;
    setFieldsBusy(true);
    try {
      const nextFields = [...exercise.trackedFields, field];
      const supabase = createBrowserClient();
      await supabase.from("session_exercises").update({ tracked_fields: nextFields }).eq("id", exercise.id);
      onTrackedFieldsChange(nextFields);
      setFieldsOpen(false);
    } finally {
      setFieldsBusy(false);
    }
  }

  async function handleRemoveField(field: TrackedField) {
    if (fieldsBusy) return;
    setFieldsBusy(true);
    try {
      const nextFields = exercise.trackedFields.filter((f) => f !== field);
      const supabase = createBrowserClient();
      await supabase.from("session_exercises").update({ tracked_fields: nextFields }).eq("id", exercise.id);
      const setIds = exercise.sets.map((s) => s.id);
      if (setIds.length > 0) {
        await supabase
          .from("set_logs")
          .update({ [ACTUAL_COLUMN[field]]: null })
          .in("id", setIds);
      }
      onTrackedFieldsChange(nextFields);
      const prop = ACTUAL_PROP[field] as keyof SetLogEntry;
      for (const set of exercise.sets) {
        onSetChange(set.id, { [prop]: null } as Partial<SetLogEntry>);
      }
    } finally {
      setFieldsBusy(false);
    }
  }

  const untrackedFields = TRACKED_FIELD_DEFS.map((f) => f.key).filter(
    (k) => !exercise.trackedFields.includes(k)
  );

  return (
    <div>
      <div className="flex items-center justify-between gap-3 mb-1">
        {swapping ? (
          <div className="flex-1">
            <div className="flex items-center gap-2">
              <input
                type="text"
                autoFocus
                value={nameDraft}
                onChange={(e) => setNameDraft(e.target.value)}
                disabled={swapBusy}
                className="flex-1 h-9 bg-surface border border-steel/30 text-chalk px-2 font-body text-sm focus:outline-none focus:border-rust disabled:opacity-60"
              />
              <button
                type="button"
                onClick={() => applySwap(nameDraft.trim())}
                disabled={swapBusy}
                className="font-body text-xs text-rust disabled:opacity-40"
              >
                {swapBusy ? "Saving…" : "Save"}
              </button>
            </div>
            {swapError && (
              <p className="font-body text-xs text-rust mt-1" role="alert">
                {swapError}
              </p>
            )}
          </div>
        ) : (
          <>
            <h3 className="font-body font-medium text-[15px]">
              {exercise.exerciseName}
              {exercise.isSwapped && (
                <span className="font-body text-[11px] text-steel ml-2 align-middle">
                  swapped
                </span>
              )}
            </h3>
            {!readOnly && (
              <div className="flex items-center gap-3 shrink-0">
                <button
                  type="button"
                  onClick={() => {
                    setNameDraft(exercise.exerciseName);
                    setSwapping(true);
                  }}
                  className="font-body text-xs text-steel"
                >
                  Swap Exercise
                </button>
                {exercise.isAdded && onDelete && (
                  <button
                    type="button"
                    onClick={onDelete}
                    disabled={deleting}
                    className="font-body text-xs text-rust disabled:opacity-40"
                  >
                    {deleting ? "Removing…" : "Remove"}
                  </button>
                )}
              </div>
            )}
          </>
        )}
      </div>

      {!readOnly && ladder && ladder.length > 0 && (
        <div className="flex flex-wrap gap-1.5 mb-2">
          {ladder.map((name) => (
            <button
              key={name}
              type="button"
              onClick={() => applySwap(name)}
              disabled={swapBusy || name === exercise.exerciseName}
              className={`h-7 px-2.5 border font-body text-xs transition-colors ${
                name === exercise.exerciseName
                  ? "bg-rust border-rust text-graphite"
                  : "border-steel/30 text-steel active:border-rust active:text-rust"
              }`}
            >
              {name}
            </button>
          ))}
        </div>
      )}

      {exercise.notes && (
        <p className="font-body text-xs text-steel mb-2">{exercise.notes}</p>
      )}

      {(exercise.videoUrl || exercise.youtubeUrl) && (
        <div className="mb-2">
          {exercise.videoUrl && (
            <video src={exercise.videoUrl} controls className="w-full max-w-[200px] bg-graphite" />
          )}
          {exercise.youtubeUrl && (
            <a
              href={exercise.youtubeUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="font-body text-xs text-rust inline-block mt-1"
            >
              Watch demo &rarr;
            </a>
          )}
        </div>
      )}

      {lastTime && (
        <p className="font-body text-xs text-steel mb-2">
          Last time: {lastTime.weight} &times; {lastTime.reps}
        </p>
      )}

      {!readOnly && (
        <div className="relative mb-2">
          <button
            type="button"
            onClick={() => setFieldsOpen((v) => !v)}
            className="font-body text-xs text-steel active:text-rust transition-colors"
          >
            Edit metrics
          </button>
          {fieldsOpen && (
            <div className="absolute z-10 left-0 mt-1 bg-surface border border-steel/30 p-2 w-56">
              {exercise.trackedFields.length > 0 && (
                <div className="flex flex-wrap gap-1 mb-1.5">
                  {exercise.trackedFields.map((f) => (
                    <button
                      key={f}
                      type="button"
                      onClick={() => handleRemoveField(f)}
                      disabled={fieldsBusy}
                      className="h-7 px-2 border border-rust/40 text-rust font-body text-xs disabled:opacity-40"
                    >
                      {fieldDef(f).label} &times;
                    </button>
                  ))}
                </div>
              )}
              {untrackedFields.length > 0 && (
                <div className="flex flex-wrap gap-1">
                  {untrackedFields.map((f) => (
                    <button
                      key={f}
                      type="button"
                      onClick={() => handleAddField(f)}
                      disabled={fieldsBusy}
                      className="h-7 px-2 border border-steel/30 text-steel font-body text-xs active:border-rust active:text-rust disabled:opacity-40"
                    >
                      + {fieldDef(f).label}
                    </button>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>
      )}

      <div className="space-y-2">
        {exercise.sets.map((set, i) => (
          <SetRow
            key={set.id}
            set={set}
            setNumber={i + 1}
            trackedFields={exercise.trackedFields}
            readOnly={readOnly}
            onChange={(patch) => {
              const wasCompleted = set.status === "completed";
              onSetChange(set.id, patch);
              if (patch.status === "completed" && !wasCompleted) {
                onSetCompleted?.({ ...set, ...patch });
              }
            }}
          />
        ))}
      </div>

      {!readOnly && (
        <button
          type="button"
          onClick={handleAddSet}
          disabled={addSetBusy}
          className="mt-2 font-body text-xs text-steel active:text-rust transition-colors disabled:opacity-40"
        >
          + Add set
        </button>
      )}

      <ExerciseVideoThread
        sessionId={sessionId}
        sessionExerciseId={exercise.id}
        groupId={groupId}
        athleteId={athleteId}
        viewerId={viewerId}
        canUpload={canUpload}
      />
    </div>
  );
}
