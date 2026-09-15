"use client";

import { useMemo, useState } from "react";
import { createBrowserClient } from "@/lib/supabase/client";
import type { SessionExerciseEntry, SetLogEntry } from "@/lib/types";
import { ExerciseSwipeCarousel } from "./exercise-swipe-carousel";
import { ExerciseVerticalCarousel } from "./exercise-vertical-carousel";
import { SwipeDirectionDiscovery } from "./swipe-direction-discovery";
import type { SwipeDirection } from "@/components/athlete/swipe-direction-setting";
import { CompleteWorkoutButton } from "@/components/session/complete-workout-button";
import { RestTimerBar, type PendingGateTask } from "@/components/session/rest-timer-bar";
import { QuickAddNlButton } from "./quick-add-nl-button";
import { SessionProgressStrip } from "./session-progress-strip";

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
  startedAt,
  gamificationEnabled,
  pendingGateTask,
  todayDate,
  coachNoteByExerciseName,
  exerciseSwipeDirection,
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
  startedAt: string;
  gamificationEnabled: boolean;
  pendingGateTask?: PendingGateTask | null;
  todayDate?: string;
  // The swipe-card carousel's coach-note-first callout — keyed by
  // exercise name, only ever populated with a note the coach explicitly
  // marked visible_to_athlete (see lib/exercise-note-history.ts). Optional
  // so nothing breaks for any call site that hasn't been updated yet.
  coachNoteByExerciseName?: Record<string, string | null>;
  // Athlete-facing preference (swipe_card_logging_and_spotter_nudge_idea.md,
  // resolved 2026-09-14) — null means "not yet chosen," which is what
  // gates the first-run discovery prompt below. Optional/defaults to
  // horizontal (today's original behavior) for any call site that hasn't
  // been updated to pass it.
  exerciseSwipeDirection?: SwipeDirection | null;
}) {
  const [exercises, setExercises] = useState(initialExercises);
  // Mirrors whichever carousel variant is active's own scroll-position
  // state (coach_mobile_v2_feature_spec.md item 4) — built once here so
  // the pinned-strip/next-preview logic never has to live inside either
  // carousel component itself.
  const [activeExerciseIndex, setActiveExerciseIndex] = useState(0);
  const [swipeDirection, setSwipeDirection] = useState<SwipeDirection | null>(
    exerciseSwipeDirection ?? "horizontal"
  );
  // Only the athlete's own live session gets the discovery prompt — a
  // coach logging a client's session in-person (viewerId !== athleteId)
  // sees neither the prompt nor a reason to change what the client
  // already prefers.
  const isOwnSession = viewerId === athleteId;
  const showDiscovery = isOwnSession && !isCompleted && exerciseSwipeDirection == null;
  const [pendingRestPrompt, setPendingRestPrompt] = useState<{
    defaultSeconds: number;
    isPrescribed: boolean;
  } | null>(null);

  // Smart-default rest duration: the set's own prescribed rest (from the
  // cardio-interval work) when it has one, else a sensible generic
  // fallback. When the coach actually prescribed a rest period,
  // `isPrescribed` tells the timer bar to auto-start the countdown at
  // that duration immediately, rather than waiting for a manual pick —
  // there's nothing to choose when the coach already specified it.
  function handleSetCompleted(set: SetLogEntry) {
    const prescribed = set.restSeconds ?? set.targetRestSeconds ?? null;
    setPendingRestPrompt({ defaultSeconds: prescribed ?? 90, isPrescribed: prescribed != null });
  }
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
    <>
      {!isCompleted && (
        <RestTimerBar
          sessionId={sessionId}
          startedAt={startedAt}
          pendingPrompt={pendingRestPrompt}
          onPromptHandled={() => setPendingRestPrompt(null)}
          pendingTask={pendingGateTask}
          athleteId={athleteId}
          groupId={groupId}
          todayDate={todayDate}
        />
      )}
      <section className="px-5 pt-4">
      {showDiscovery && (
        <SwipeDirectionDiscovery
          athleteId={athleteId}
          onChosen={(direction) => setSwipeDirection(direction)}
        />
      )}
      <SessionProgressStrip exercises={exercises} activeIndex={activeExerciseIndex} />
      {swipeDirection === "vertical" ? (
        <ExerciseVerticalCarousel
          exercises={exercises}
          lastTimeByExercise={lastTimeByExercise}
          ladderByExercise={ladderByExercise}
          coachNoteByExerciseName={coachNoteByExerciseName ?? {}}
          readOnly={isCompleted}
          onSetChange={handleSetChange}
          onSetAdded={handleSetAdded}
          onRenamed={handleRenamed}
          onTrackedFieldsChange={handleTrackedFieldsChange}
          onDelete={handleDeleteExercise}
          deletingId={deletingId}
          sessionId={sessionId}
          groupId={groupId}
          athleteId={athleteId}
          viewerId={viewerId}
          canUploadVideo={canUploadVideo}
          onSetCompleted={handleSetCompleted}
          gamificationEnabled={gamificationEnabled}
          onActiveIndexChange={setActiveExerciseIndex}
        />
      ) : (
        <ExerciseSwipeCarousel
          exercises={exercises}
          lastTimeByExercise={lastTimeByExercise}
          ladderByExercise={ladderByExercise}
          coachNoteByExerciseName={coachNoteByExerciseName ?? {}}
          readOnly={isCompleted}
          onSetChange={handleSetChange}
          onSetAdded={handleSetAdded}
          onRenamed={handleRenamed}
          onTrackedFieldsChange={handleTrackedFieldsChange}
          onDelete={handleDeleteExercise}
          deletingId={deletingId}
          sessionId={sessionId}
          groupId={groupId}
          athleteId={athleteId}
          viewerId={viewerId}
          canUploadVideo={canUploadVideo}
          onSetCompleted={handleSetCompleted}
          gamificationEnabled={gamificationEnabled}
          onActiveIndexChange={setActiveExerciseIndex}
        />
      )}

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
                aria-label="Exercise name"
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
            <div className="space-y-2">
              <button
                type="button"
                onClick={() => setAddingExercise(true)}
                className="w-full h-11 border border-steel/30 text-steel font-body text-sm active:border-rust active:text-rust transition-colors"
              >
                + Add exercise
              </button>
              {/* Coach mobile app's NL quick-add (coach_mobile_app_
                  redesign_plan.md) — a coach driving someone else's
                  in-person session only; an athlete logging their own
                  session keeps the plain manual add above. */}
              {!isOwnSession && (
                <QuickAddNlButton
                  sessionId={sessionId}
                  nextExerciseOrder={
                    exercises.length > 0 ? Math.max(...exercises.map((e) => e.exerciseOrder)) + 1 : 0
                  }
                  onAdded={(entries) => setExercises((prev) => [...prev, ...entries])}
                />
              )}
            </div>
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
    </>
  );
}
