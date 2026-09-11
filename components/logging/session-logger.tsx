"use client";

import { useMemo, useState } from "react";
import { createBrowserClient } from "@/lib/supabase/client";
import type { SessionExerciseEntry, SetLogEntry } from "@/lib/types";
import { ExerciseCard } from "./exercise-card";
import { CompleteWorkoutButton } from "@/components/session/complete-workout-button";

export function SessionLogger({
  sessionId,
  isCompleted,
  initialExercises,
  lastTimeByExercise,
  ladderByExercise,
  raised,
  groupId,
  athleteId,
  viewerId,
  canUploadVideo,
}: {
  sessionId: string;
  isCompleted: boolean;
  initialExercises: SessionExerciseEntry[];
  lastTimeByExercise: Record<string, { weight: number; reps: number }>;
  ladderByExercise: Record<string, string[]>;
  raised?: boolean;
  groupId: string;
  athleteId: string;
  viewerId: string | null;
  canUploadVideo: boolean;
}) {
  const [exercises, setExercises] = useState(initialExercises);
  const [addingExercise, setAddingExercise] = useState(false);
  const [newExerciseName, setNewExerciseName] = useState("");
  const [addExerciseBusy, setAddExerciseBusy] = useState(false);
  const [deletingId, setDeletingId] = useState<string | null>(null);

  // A client can bolt on extras mid-session (machine's free, feeling
  // ambitious) but shouldn't be able to turn "log today's workout" into
  // an unbounded list — 8 self-added exercises is a generous ceiling that
  // still stops runaway growth.
  const addedCount = exercises.filter((e) => e.isAdded).length;
  const MAX_ADDED_EXERCISES = 8;

  const allSetsResolved = useMemo(
    () =>
      exercises.length > 0 &&
      exercises.every(
        (ex) => ex.sets.length > 0 && ex.sets.every((s) => s.status !== "pending")
      ),
    [exercises]
  );

  // Every mutation below routes through the functional form of setState, so
  // two concurrent saves (e.g. blurring the reps field right as the complete
  // button is tapped) always merge onto the latest committed state instead
  // of a stale closure — otherwise whichever async call resolves last can
  // silently overwrite the other's field in local UI state.
  function updateExercise(
    exerciseId: string,
    updater: (ex: SessionExerciseEntry) => SessionExerciseEntry
  ) {
    setExercises((prev) => prev.map((ex) => (ex.id === exerciseId ? updater(ex) : ex)));
  }

  function handleSetChange(exerciseId: string, setId: string, patch: Partial<SetLogEntry>) {
    updateExercise(exerciseId, (ex) => ({
      ...ex,
      sets: ex.sets.map((s) => (s.id === setId ? { ...s, ...patch } : s)),
    }));
  }

  function handleSetAdded(exerciseId: string, set: SetLogEntry) {
    updateExercise(exerciseId, (ex) => ({ ...ex, sets: [...ex.sets, set] }));
  }

  function handleRenamed(exerciseId: string, name: string) {
    updateExercise(exerciseId, (ex) => ({ ...ex, exerciseName: name, isSwapped: true }));
  }

  function handleTrackedFieldsChange(exerciseId: string, fields: SessionExerciseEntry["trackedFields"]) {
    updateExercise(exerciseId, (ex) => ({ ...ex, trackedFields: fields }));
  }

  async function handleDeleteExercise(exerciseId: string) {
    if (deletingId) return;
    setDeletingId(exerciseId);
    try {
      const supabase = createBrowserClient();
      await supabase.from("session_exercises").delete().eq("id", exerciseId);
      setExercises((prev) => prev.filter((e) => e.id !== exerciseId));
    } finally {
      setDeletingId(null);
    }
  }

  async function handleAddExercise() {
    const name = newExerciseName.trim();
    if (!name || addExerciseBusy || addedCount >= MAX_ADDED_EXERCISES) return;
    setAddExerciseBusy(true);
    try {
      const supabase = createBrowserClient();
      const nextOrder =
        exercises.length > 0 ? Math.max(...exercises.map((e) => e.exerciseOrder)) + 1 : 0;

      const { data: sessionExercise } = await supabase
        .from("session_exercises")
        .insert({
          session_id: sessionId,
          exercise_name: name,
          exercise_order: nextOrder,
          is_added: true,
        })
        .select("id, exercise_name, exercise_order, is_swapped, is_added, tracked_fields")
        .single();

      if (!sessionExercise) return;

      const { data: sets } = await supabase
        .from("set_logs")
        .insert({ session_exercise_id: sessionExercise.id, set_order: 0 })
        .select("id, set_order, weight, reps, rpe, rir, tempo, time_seconds, height, distance, rest_seconds, pace, status");

      setExercises((prev) => [
        ...prev,
        {
          id: sessionExercise.id,
          exerciseName: sessionExercise.exercise_name,
          exerciseOrder: sessionExercise.exercise_order,
          isSwapped: sessionExercise.is_swapped,
          isAdded: sessionExercise.is_added,
          trackedFields: sessionExercise.tracked_fields,
          videoUrl: null,
          youtubeUrl: null,
          notes: null,
          sets: (sets ?? []).map((s: any) => ({
            id: s.id,
            setOrder: s.set_order,
            weight: s.weight,
            reps: s.reps,
            rpe: s.rpe,
            rir: s.rir,
            tempo: s.tempo,
            timeSeconds: s.time_seconds,
            height: s.height,
            distance: s.distance,
            restSeconds: s.rest_seconds,
            pace: s.pace,
            status: s.status,
          })),
        },
      ]);
      setNewExerciseName("");
      setAddingExercise(false);
    } finally {
      setAddExerciseBusy(false);
    }
  }

  return (
    <section className="px-5 pt-4">
      <div className="space-y-6">
        {exercises.map((exercise) => (
          <ExerciseCard
            key={exercise.id}
            exercise={exercise}
            lastTime={lastTimeByExercise[exercise.exerciseName]}
            ladder={ladderByExercise[exercise.exerciseName]}
            readOnly={isCompleted}
            onSetChange={(setId, patch) => handleSetChange(exercise.id, setId, patch)}
            onSetAdded={(set) => handleSetAdded(exercise.id, set)}
            onRenamed={(name) => handleRenamed(exercise.id, name)}
            onTrackedFieldsChange={(fields) => handleTrackedFieldsChange(exercise.id, fields)}
            onDelete={() => handleDeleteExercise(exercise.id)}
            deleting={deletingId === exercise.id}
            sessionId={sessionId}
            groupId={groupId}
            athleteId={athleteId}
            viewerId={viewerId}
            canUpload={canUploadVideo}
          />
        ))}
      </div>

      {!isCompleted && (
        <div className="mt-6 pb-4">
          {addedCount >= MAX_ADDED_EXERCISES ? (
            <p className="font-body text-xs text-steel">
              You&apos;ve added the max of {MAX_ADDED_EXERCISES} extra exercises for this workout.
            </p>
          ) : addingExercise ? (
            <div className="flex items-center gap-2">
              <input
                type="text"
                autoFocus
                value={newExerciseName}
                onChange={(e) => setNewExerciseName(e.target.value)}
                placeholder="Exercise name"
                className="flex-1 h-11 bg-surface border border-steel/30 text-chalk px-3 font-body focus:outline-none focus:border-rust"
              />
              <button
                type="button"
                onClick={handleAddExercise}
                disabled={addExerciseBusy}
                className="h-11 px-4 bg-rust text-graphite font-body text-sm font-medium disabled:opacity-40"
              >
                Add
              </button>
            </div>
          ) : (
            <button
              type="button"
              onClick={() => setAddingExercise(true)}
              className="w-full h-11 border border-steel/30 text-steel font-body text-sm active:border-rust active:text-rust transition-colors"
            >
              + Add exercise
            </button>
          )}
        </div>
      )}

      {!isCompleted && (
        <CompleteWorkoutButton
          sessionId={sessionId}
          allSetsResolved={allSetsResolved}
          disabled={false}
          raised={raised}
        />
      )}
    </section>
  );
}
