"use client";

import { useCallback, useMemo, useState } from "react";
import { cleanExerciseName, exerciseNameProblem } from "@/lib/exercise-name-guard";
import { existingLibraryName } from "@/lib/exercise-search";
import { createBrowserClient } from "@/lib/supabase/client";
import { saved } from "@/lib/saved";
import { SetSaveBanner, SetSaveProvider } from "./set-save-context";
import type { SessionExerciseEntry, SetLogEntry } from "@/lib/types";
import { ExerciseSwipeCarousel } from "./exercise-swipe-carousel";
import { ExerciseVerticalCarousel } from "./exercise-vertical-carousel";
import { SwipeDirectionDiscovery } from "./swipe-direction-discovery";
import type { SwipeDirection } from "@/components/athlete/swipe-direction-setting";
import { CompleteWorkoutButton } from "@/components/session/complete-workout-button";
import { ResumeWorkoutButton } from "@/components/session/resume-workout-button";
import { isNoLoadExercise } from "@/lib/exercise-load";
import { RestTimerBar, type PendingGateTask } from "@/components/session/rest-timer-bar";
import { QuickAddNlButton } from "./quick-add-nl-button";
import { SessionProgressStrip } from "./session-progress-strip";
import { WingItBox } from "./wing-it-box";
import { DemoLibraryProvider } from "./demo-library-context";
import type { RestForSet } from "@/lib/rest-time";
import { DemoBrowserSheet } from "./demo-browser-sheet";
import type { DemoRow } from "@/lib/exercise-demo";
import type { ReadForViewer } from "@/lib/read-content/for-viewer";
import { ExerciseNameInput } from "@/components/coach/exercise-name-input";
import { fetchExerciseHistory } from "@/lib/exercise-history-fetch";

export function SessionLogger({
  sessionId,
  isCompleted,
  initialExercises,
  lastTimeByExercise,
  ladderByExercise,
  raised,
  finishedLine = null,
  pausedSessionId = null,
  coachMode,
  groupId,
  athleteId,
  viewerId,
  canUploadVideo,
  gamificationEnabled,
  postWorkoutCards = true,
  pendingGateTask,
  todayDate,
  coachNoteByExerciseName,
  exerciseSwipeDirection,
  demoLibrary,
  read,
  wingIt = false,
}: {
  sessionId: string;
  isCompleted: boolean;
  initialExercises: SessionExerciseEntry[];
  lastTimeByExercise: Record<string, { weight: number; reps: number }>;
  ladderByExercise: Record<string, string[]>;
  raised?: boolean;
  // Once the workout is completed this line replaces the buttons; while it is paused, Resume workout takes the place of Complete workout.
  finishedLine?: string | null;
  pausedSessionId?: string | null;
  coachMode?: { homeHref: string; clientIsMinor: boolean; offerWalkIn?: boolean };
  groupId: string;
  athleteId: string;
  viewerId: string | null;
  canUploadVideo: boolean;
  gamificationEnabled: boolean;
  // The group's post-workout cards setting (default true when not passed).
  postWorkoutCards?: boolean;
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
  // The coach's exercise library (name and demo links) so a demo is found from an exercise's current name, including one added or swapped mid-workout.
  demoLibrary?: DemoRow[];
  // A coach logging a client with no program (the wing-it logger): the box at the top adds what they do as they go.
  wingIt?: boolean;
  // Today's short reading for the person resting, or null when Read is off (only ever set for the athlete's own session).
  read?: ReadForViewer | null;
}) {
  const [exercises, setExercises] = useState(initialExercises);
  // "Last time" for an exercise swapped in or added during this workout (the page only knew the names it started with).
  const [lastTimeAdded, setLastTimeAdded] = useState<Record<string, { weight: number; reps: number }>>({});
  const lastTimes = useMemo(() => ({ ...lastTimeByExercise, ...lastTimeAdded }), [lastTimeByExercise, lastTimeAdded]);
  // The one demo sheet for the workout: which exercise it is showing (null = closed). Closing it brings the workout back to the exercise it ended on.
  const [demoExerciseId, setDemoExerciseId] = useState<string | null>(null);
  const closeDemo = useCallback(() => {
    const id = demoExerciseId;
    setDemoExerciseId(null);
    if (id) {
      requestAnimationFrame(() =>
        document.querySelector(`[data-exercise-id="${id}"]`)?.scrollIntoView({ behavior: "smooth", inline: "center", block: "center" })
      );
    }
  }, [demoExerciseId]);
  const demoBrowser = useMemo(() => ({ library: demoLibrary ?? [], openDemo: (id: string) => setDemoExerciseId(id) }), [demoLibrary]);
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
    source?: "coach" | "typed";
    readySeconds?: number;
  } | null>(null);

  // Smart-default rest duration: the set's own prescribed rest (from the
  // cardio-interval work) when it has one, else a sensible generic
  // fallback. When the coach actually prescribed a rest period,
  // `isPrescribed` tells the timer bar to auto-start the countdown at
  // that duration immediately, rather than waiting for a manual pick —
  // there's nothing to choose when the coach already specified it.
  function handleSetCompleted(set: SetLogEntry, rest?: RestForSet | null) {
    // The coach's rest for THIS set (or the last prescribed set before it, for a set the client added) is the only option: the timer starts it by itself. A rest
    // the client typed is used only when the coach prescribed none, and with nothing at all the usual 60/90/120 picker shows.
    if (rest && rest.source === "coach") {
      // A range counts down to its high end; the low end is where the client may already go.
      setPendingRestPrompt({ defaultSeconds: rest.maxSeconds ?? rest.seconds, isPrescribed: true, source: "coach", ...(rest.maxSeconds ? { readySeconds: rest.seconds } : {}) });
      return;
    }
    const typed = set.restSeconds ?? null;
    setPendingRestPrompt({ defaultSeconds: typed ?? 90, isPrescribed: typed != null, source: typed != null ? "typed" : undefined });
  }
  const [addingExercise, setAddingExercise] = useState(false);
  const [newExerciseName, setNewExerciseName] = useState("");
  const [addExerciseBusy, setAddExerciseBusy] = useState(false);
  const [addNameProblem, setAddNameProblem] = useState<string | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);

  // A client can bolt on extras mid-session (machine's free, feeling
  // ambitious) but shouldn't be able to turn "log today's workout" into
  // an unbounded list — 8 self-added exercises is a generous ceiling that
  // still stops runaway growth.
  // The ceiling is for a client's own workout only: a coach running a session (and a wing-it one is all added exercises) is never stopped.
  const addedCount = exercises.filter((e) => e.isAdded).length;
  const MAX_ADDED_EXERCISES = 8;
  const atAddCap = isOwnSession && addedCount >= MAX_ADDED_EXERCISES;
  const nextExerciseOrder = exercises.length > 0 ? Math.max(...exercises.map((e) => e.exerciseOrder)) + 1 : 0;
  const libraryNames = useMemo(() => Array.from(new Set((demoLibrary ?? []).map((r) => r.name))), [demoLibrary]);

  const allSetsResolved = useMemo(
    () =>
      exercises.length > 0 &&
      exercises.every(
        (ex) => ex.sets.length > 0 && ex.sets.every((s) => s.status !== "pending")
      ),
    [exercises]
  );

  // How many sets are marked done: with none, Complete asks once more before finishing an empty workout (Oct 19 audit: 5 of 127 workout logs had zero sets).
  const completedSetCount = useMemo(() => exercises.reduce((n, ex) => n + ex.sets.filter((s) => s.status === "completed").length, 0), [exercises]);

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

  // Kept in set order, so a set put back by Undo lands where it was.
  function handleSetAdded(exerciseId: string, set: SetLogEntry) {
    updateExercise(exerciseId, (ex) => ({ ...ex, sets: [...ex.sets, set].sort((a, b) => a.setOrder - b.setOrder) }));
  }

  function handleSetRemoved(exerciseId: string, setId: string) {
    updateExercise(exerciseId, (ex) => ({ ...ex, sets: ex.sets.filter((s) => s.id !== setId) }));
  }

  // History under the exercise's new name: "Last time", the volume sparkline, and last time's weight offered (as a swipeable suggestion, never filled in) in the sets not logged yet.
  async function loadHistory(exerciseId: string, name: string) {
    const history = await fetchExerciseHistory(createBrowserClient(), { athleteId, exerciseName: name, excludeSessionId: sessionId });
    const lastTime = history.lastTime;
    if (lastTime) setLastTimeAdded((prev) => ({ ...prev, [name]: lastTime }));
    updateExercise(exerciseId, (ex) =>
      ex.exerciseName !== name
        ? ex
        : {
            ...ex,
            volumeHistory: history.volumeHistory,
            sets: lastTime ? ex.sets.map((s) => (s.weight == null && s.suggestedWeight == null ? { ...s, suggestedWeight: lastTime.weight } : s)) : ex.sets,
          }
    );
  }

  function handleRenamed(exerciseId: string, name: string) {
    // The old exercise's history and suggested weights do not belong to the new one.
    updateExercise(exerciseId, (ex) => ({
      ...ex,
      exerciseName: name,
      displayName: null, isSwapped: true,
      volumeHistory: [],
      sets: ex.sets.map((s) => (s.weight == null ? { ...s, suggestedWeight: null } : s)),
    }));
    loadHistory(exerciseId, name);
  }

  function handleExercisesAdded(entries: SessionExerciseEntry[]) {
    setExercises((prev) => [...prev, ...entries]);
    for (const e of entries) loadHistory(e.id, e.exerciseName);
  }

  function handleTrackedFieldsChange(exerciseId: string, fields: SessionExerciseEntry["trackedFields"]) {
    updateExercise(exerciseId, (ex) => ({ ...ex, trackedFields: fields }));
  }

  async function handleDeleteExercise(exerciseId: string) {
    if (deletingId) return;
    setDeletingId(exerciseId);
    try {
      const supabase = createBrowserClient();
      // The card goes only when the exercise is really gone (otherwise it stays, and the workout cannot be finished without it).
      if (await saved(supabase.from("session_exercises").delete().eq("id", exerciseId))) {
        setExercises((prev) => prev.filter((e) => e.id !== exerciseId));
      }
    } finally {
      setDeletingId(null);
    }
  }

  async function handleAddExercise(picked?: string) {
    // A spelling of an exercise in the coach's library is added under the library's own name.
    const typed = cleanExerciseName(picked ?? newExerciseName);
    const name = typed ? existingLibraryName(typed, (demoLibrary ?? []).map((r) => r.name)) ?? typed : typed;
    if (!name || addExerciseBusy || atAddCap) return;
    // Never an exercise named with only numbers or with its sets and reps.
    const problem = exerciseNameProblem(name);
    if (problem) {
      setAddNameProblem(problem);
      return;
    }
    setAddNameProblem(null);
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

      if (!sessionExercise) {
        setAddNameProblem("Couldn't add that exercise. Try again.");
        return;
      }

      const { data: sets, error: setsError } = await supabase
        .from("set_logs")
        .insert({ session_exercise_id: sessionExercise.id, set_order: 0 })
        .select("id, set_order, weight, reps, rpe, rir, tempo, time_seconds, height, distance, rest_seconds, pace, status");

      // An exercise whose first set did not save is not kept: it would show with no sets to log. It is taken off again and the person is told, instead of an empty exercise appearing (or nothing at all).
      if (setsError || !sets || sets.length === 0) {
        // Deliberately not checked here: this only tidies up the exercise that was just made, the person is told below that it did not save, and the failure bar says if the cleanup itself failed.
        await saved(supabase.from("session_exercises").delete().eq("id", sessionExercise.id));
        setAddNameProblem("Couldn't add that exercise. Check your signal and try again.");
        return;
      }

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
      loadHistory(sessionExercise.id, sessionExercise.exercise_name);
      setNewExerciseName("");
      setAddingExercise(false);
    } catch {
      setAddNameProblem("Couldn't add that exercise. Check your signal and try again.");
    } finally {
      setAddExerciseBusy(false);
    }
  }

  return (
    <DemoLibraryProvider value={demoLibrary ? demoBrowser : null}>
    <SetSaveProvider>
      {/* The rest bar opens over the top of the card (absolute inside this box), so nothing under it moves when rest starts. */}
      <div className="relative">
      {!isCompleted && (
        <RestTimerBar
          sessionId={sessionId}
          pendingPrompt={pendingRestPrompt}
          onPromptHandled={() => setPendingRestPrompt(null)}
          pendingTask={pendingGateTask}
          athleteId={athleteId}
          groupId={groupId}
          todayDate={todayDate}
          read={read}
        />
      )}
      <SetSaveBanner />
      <section className="px-5 pt-1">
      {showDiscovery && (
        <SwipeDirectionDiscovery
          athleteId={athleteId}
          onChosen={(direction) => setSwipeDirection(direction)}
        />
      )}
      {wingIt && !isCompleted && (
        <>
          <WingItBox sessionId={sessionId} nextOrder={nextExerciseOrder} library={libraryNames} onAdded={handleExercisesAdded} />
          {exercises.length === 0 && <p className="font-body text-sm text-steel mb-2">Type or say what they&apos;re doing. Add more any time.</p>}
        </>
      )}
      <SessionProgressStrip exercises={exercises} activeIndex={activeExerciseIndex} />
      <div className="relative">
      {swipeDirection === "vertical" ? (
        <ExerciseVerticalCarousel
          exercises={exercises}
          lastTimeByExercise={lastTimes}
          ladderByExercise={ladderByExercise}
          coachNoteByExerciseName={coachNoteByExerciseName ?? {}}
          readOnly={isCompleted}
          onSetChange={handleSetChange}
          onSetAdded={handleSetAdded}
          onSetRemoved={handleSetRemoved}
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
          lastTimeByExercise={lastTimes}
          ladderByExercise={ladderByExercise}
          coachNoteByExerciseName={coachNoteByExerciseName ?? {}}
          readOnly={isCompleted}
          onSetChange={handleSetChange}
          onSetAdded={handleSetAdded}
          onSetRemoved={handleSetRemoved}
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

      {/* "+ Add exercise" (Ron, Oct 29: "Need an add ... button inside of the workout logger"): one tap opens the same library search as the program builder and Swap; tapping a
          match adds it. Swiping sideways it sits on the dots row (right edge) and the box opens over the top of the card; scrolling down it stays under the list. */}
      {!isCompleted && (
        <div
          className={
            swipeDirection === "vertical"
              ? "mt-2 pb-2"
              : addingExercise || atAddCap
              ? "absolute left-0 right-0 top-0 z-30 bg-graphite border border-steel/30 p-3 shadow-lg"
              : "absolute right-0 top-0 z-30"
          }
        >
          {atAddCap ? (
            <p className="font-body text-xs text-steel">
              You&apos;ve added the max of {MAX_ADDED_EXERCISES} extra exercises for this workout.
            </p>
          ) : addingExercise ? (
            <div className="space-y-2">
              <div className="flex items-center gap-2">
                <div className="flex-1 min-w-0">
                  <ExerciseNameInput
                    value={newExerciseName}
                    onChange={(v) => {
                      setNewExerciseName(v);
                      setAddNameProblem(null);
                    }}
                    onCommit={(v) => setNewExerciseName(v)}
                    onPick={(v) => handleAddExercise(v)}
                    suggestions={libraryNames}
                    demoLibrary={demoLibrary}
                    autoFocus
                  />
                </div>
                <button
                  type="button"
                  onClick={() => handleAddExercise()}
                  disabled={addExerciseBusy || !newExerciseName.trim()}
                  className="min-h-11 px-4 bg-rust text-graphite font-body text-sm font-medium disabled:opacity-40"
                >
                  {addExerciseBusy ? "Adding…" : "Add"}
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setAddingExercise(false);
                    setNewExerciseName("");
                    setAddNameProblem(null);
                  }}
                  disabled={addExerciseBusy}
                  className="min-h-11 px-1 font-body text-xs text-steel disabled:opacity-40"
                >
                  Cancel
                </button>
              </div>
              {addNameProblem && (
                <p className="font-body text-xs text-rust" role="alert">
                  {addNameProblem}
                </p>
              )}
              {/* Coach mobile app's NL quick-add (coach_mobile_app_redesign_plan.md) — a coach driving someone else's in-person session only; an athlete logging their
                  own session keeps the library search above. */}
              {!isOwnSession && (
                <QuickAddNlButton sessionId={sessionId} nextExerciseOrder={nextExerciseOrder} library={libraryNames} onAdded={handleExercisesAdded} />
              )}
            </div>
          ) : (
            <button
              type="button"
              onClick={() => setAddingExercise(true)}
              className="h-7 px-3 border border-rust/60 text-rust font-body text-xs font-medium active:bg-rust active:text-graphite transition-colors"
            >
              + Add exercise
            </button>
          )}
        </div>
      )}
      </div>

      {!isCompleted && (
        <CompleteWorkoutButton
          sessionId={sessionId}
          allSetsResolved={allSetsResolved}
          completedSetCount={completedSetCount}
          disabled={false}
          raised={raised && !exercises.every((e) => isNoLoadExercise(e.exerciseName))}
          coachMode={coachMode}
          postWorkoutCards={postWorkoutCards}
          pauseHref={coachMode ? coachMode.homeHref : `/groups/${groupId}`}
        />
      )}
      {isCompleted && finishedLine && (
        <p className="mt-4 mb-2 text-center font-display font-bold uppercase text-lg text-chalk" role="status">
          {finishedLine}
        </p>
      )}
      {isCompleted && pausedSessionId && (
        <div className={`fixed ${raised ? "bottom-16" : "bottom-0"} left-0 right-0 bg-graphite border-t border-steel/20 px-5 py-4`}>
          <ResumeWorkoutButton sessionId={pausedSessionId} />
        </div>
      )}
      </section>
      </div>
      {demoExerciseId && demoLibrary && (
        <DemoBrowserSheet exercises={exercises} library={demoLibrary} currentId={demoExerciseId} onChange={setDemoExerciseId} onClose={closeDemo} />
      )}
    </SetSaveProvider>
    </DemoLibraryProvider>
  );
}
