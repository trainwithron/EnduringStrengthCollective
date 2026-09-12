"use client";

import { useState } from "react";
import Link from "next/link";
import { createBrowserClient } from "@/lib/supabase/client";
import type { SessionRecap } from "@/lib/session-recap-data";
import type { WorkoutOverviewExercise } from "@/lib/workout-overview-data";
import { RecapExerciseRow } from "./recap-exercise-row";
import { NextWorkoutExerciseRow } from "./next-workout-exercise-row";
import { SaveToast } from "./save-toast";
import { flashSaved, flashSaveError } from "@/lib/save-toast";

interface NextWorkout {
  workoutId: string;
  title: string;
  exercises: WorkoutOverviewExercise[];
}

function formatDuration(seconds: number | null): string {
  if (!seconds) return "—";
  const m = Math.floor(seconds / 60);
  return `${m} min`;
}

export function RecapAndUpNext({
  recap,
  nextWorkout,
  carriedForwardNotes,
  groupId,
}: {
  recap: SessionRecap;
  nextWorkout: NextWorkout | null;
  carriedForwardNotes: Record<string, { body: string; date: string }>;
  groupId: string;
}) {
  const [showNext, setShowNext] = useState(false);
  const [sessionNote, setSessionNote] = useState(recap.sessionNote);
  const [sessionNoteOpen, setSessionNoteOpen] = useState(false);
  const [exercises, setExercises] = useState(nextWorkout?.exercises ?? []);
  const [swapTarget, setSwapTarget] = useState<{ id: string; name: string } | null>(null);
  const [swapDraft, setSwapDraft] = useState("");

  async function handleSessionNoteBlur() {
    if (sessionNote === recap.sessionNote) return;
    const supabase = createBrowserClient();
    const { error } = await supabase
      .from("session_coach_notes")
      .upsert(
        { session_id: recap.sessionId, group_id: recap.groupId, body: sessionNote, updated_at: new Date().toISOString() },
        { onConflict: "session_id" }
      );
    if (error) flashSaveError();
    else flashSaved();
  }

  function openSwap(exerciseId: string, currentName: string) {
    setSwapTarget({ id: exerciseId, name: currentName });
    setSwapDraft(currentName);
  }

  async function confirmSwap() {
    if (!swapTarget) return;
    const trimmed = swapDraft.trim();
    if (!trimmed || trimmed === swapTarget.name) {
      setSwapTarget(null);
      return;
    }
    const supabase = createBrowserClient();
    // is_swapped lives on session_exercises (a per-athlete-session flag,
    // used elsewhere for the athlete's own in-session swap flow) — this
    // is renaming the shared TEMPLATE row (group_workout_exercises),
    // which has no such column at all.
    const { error } = await supabase
      .from("group_workout_exercises")
      .update({ exercise_name: trimmed })
      .eq("id", swapTarget.id);
    if (error) {
      flashSaveError();
    } else {
      setExercises((prev) =>
        prev.map((ex) => (ex.id === swapTarget.id ? { ...ex, exerciseName: trimmed } : ex))
      );
      flashSaved();
    }
    setSwapTarget(null);
  }

  function handleSaveChanges() {
    // Every field on this screen already auto-persists the moment it's
    // edited (same convention as everywhere else in this app) — this
    // button is a confirmation, not a separate write path, matching the
    // established discipline of never having a draft/unsaved-changes
    // state to lose.
    flashSaved();
  }

  return (
    <main className="min-h-screen bg-graphite text-chalk font-body pb-16">
      <SaveToast />
      <header className="px-5 pt-8 pb-4 border-b border-steel/20">
        <Link
          href={`/groups/${groupId}/athletes/${recap.athleteId}`}
          className="font-body text-xs text-steel uppercase tracking-wide"
        >
          &larr; Back to client profile
        </Link>
        <h1 className="font-display font-bold text-2xl uppercase leading-none mt-3">Recap &amp; Up Next</h1>
      </header>

      <div className="px-5 pt-6 max-w-2xl mx-auto space-y-4">
        {/* Card 1 — today's recap. Shrinks to a pinned compact header once
            the next-workout card is shown; the transition itself (not just
            the entrance below) uses the same springy overshoot easing. */}
        <div
          className="border border-steel/20 bg-surface/40 transition-all duration-300"
          style={{ transitionTimingFunction: "cubic-bezier(.34,1.56,.64,1)" }}
        >
          {showNext ? (
            <button
              type="button"
              onClick={() => setShowNext(false)}
              className="w-full flex items-center justify-between gap-3 px-5 py-3 text-left"
            >
              <span className="font-body text-sm font-medium">{recap.workoutTitle} — completed</span>
              <span className="font-body text-xs text-rust">Show recap</span>
            </button>
          ) : (
            <div className="p-5">
              <p className="font-body text-xs text-steel uppercase tracking-wide">{recap.athleteName}</p>
              <h2 className="font-display font-bold text-2xl uppercase leading-none mt-1">
                {recap.workoutTitle}
              </h2>
              <p className="font-body text-xs text-steel mt-2">
                {recap.completedAt ? new Date(recap.completedAt).toLocaleString() : "—"} ·{" "}
                {formatDuration(recap.durationSeconds)}
              </p>

              <div className="grid grid-cols-3 gap-3 mt-4">
                <div className="border border-steel/20 p-3 text-center">
                  <p className="font-display text-xl leading-none">{Math.round(recap.totalVolume)}</p>
                  <p className="font-body text-[10px] text-steel uppercase mt-1">Volume</p>
                </div>
                <div className="border border-steel/20 p-3 text-center">
                  <p className="font-display text-xl leading-none">{recap.totalSetsCompleted}</p>
                  <p className="font-body text-[10px] text-steel uppercase mt-1">Sets</p>
                </div>
                <div className="border border-steel/20 p-3 text-center">
                  <p className="font-display text-xl leading-none">{recap.prCount}</p>
                  <p className="font-body text-[10px] text-steel uppercase mt-1">PRs</p>
                </div>
              </div>

              <div className="space-y-2 mt-5">
                {recap.exercises.map((ex) => (
                  <RecapExerciseRow key={ex.sessionExerciseId} exercise={ex} groupId={groupId} />
                ))}
              </div>

              <div className="mt-4 border-t border-steel/15 pt-4">
                <button
                  type="button"
                  onClick={() => setSessionNoteOpen((v) => !v)}
                  className="font-body text-xs text-steel active:text-rust transition-colors"
                >
                  {sessionNoteOpen ? "Hide session note" : "Session note"}
                </button>
                {sessionNoteOpen && (
                  <textarea
                    value={sessionNote}
                    onChange={(e) => setSessionNote(e.target.value)}
                    onBlur={handleSessionNoteBlur}
                    placeholder="Coach-only note about this whole session — never visible to the athlete"
                    rows={3}
                    className="w-full mt-2 bg-graphite border border-steel/30 text-chalk px-2 py-1.5 font-body text-xs focus:outline-none focus:border-rust"
                  />
                )}
              </div>

              {nextWorkout && (
                <button
                  type="button"
                  onClick={() => setShowNext(true)}
                  className="w-full h-11 mt-5 bg-rust text-graphite font-display uppercase text-sm font-bold active:bg-rust/80 transition-colors"
                >
                  Show {recap.athleteName}&apos;s next workout
                </button>
              )}
            </div>
          )}
        </div>

        {/* Card 2 — next workout, editable shadow preview. */}
        {showNext && nextWorkout && (
          <div className="border border-steel/20 bg-surface/40 p-5 recap-bounce-in">
            <div className="flex items-center justify-between gap-3">
              <h2 className="font-display font-bold text-xl uppercase leading-none">{nextWorkout.title}</h2>
              <span className="font-body text-[10px] text-rust uppercase tracking-wide border border-rust/40 px-2 py-1">
                Editable draft
              </span>
            </div>

            <div className="space-y-2 mt-4">
              {exercises.map((ex) => (
                <NextWorkoutExerciseRow
                  key={ex.id}
                  exercise={ex}
                  carriedForwardNote={carriedForwardNotes[ex.exerciseName]}
                  onSwap={openSwap}
                />
              ))}
            </div>

            <p className="font-body text-xs text-steel mt-5">
              Every change here writes directly to {recap.athleteName}&apos;s actual next workout — the
              same program the app will show them, adjusted for what just happened today.
            </p>
            <button
              type="button"
              onClick={handleSaveChanges}
              className="w-full h-11 mt-3 bg-rust text-graphite font-display uppercase text-sm font-bold active:bg-rust/80 transition-colors"
            >
              Save changes
            </button>
          </div>
        )}
      </div>

      {swapTarget && (
        <div className="fixed inset-0 z-40 bg-graphite/95 flex items-center justify-center p-6">
          <div className="bg-surface border border-steel/30 w-full max-w-sm p-5">
            <h3 className="font-display uppercase text-sm tracking-wide mb-3">Swap exercise</h3>
            <input
              type="text"
              autoFocus
              value={swapDraft}
              onChange={(e) => setSwapDraft(e.target.value)}
              className="w-full h-10 bg-graphite border border-steel/30 text-chalk px-2 font-body text-sm focus:outline-none focus:border-rust"
            />
            <div className="flex items-center justify-end gap-3 mt-4">
              <button type="button" onClick={() => setSwapTarget(null)} className="font-body text-sm text-steel">
                Cancel
              </button>
              <button
                type="button"
                onClick={confirmSwap}
                className="h-9 px-4 bg-rust text-graphite font-body text-sm font-medium"
              >
                Save
              </button>
            </div>
          </div>
        </div>
      )}
    </main>
  );
}
