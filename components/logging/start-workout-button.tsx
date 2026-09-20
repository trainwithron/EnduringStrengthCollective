"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { createBrowserClient } from "@/lib/supabase/client";
import type { ExerciseSetTarget } from "@/lib/types";
import type { TrackedField } from "@/lib/exercise-fields";
import { findMatchingBookingId } from "@/lib/booking-session-link";

interface TemplateExercise {
  id: string;
  exerciseName: string;
  exerciseOrder: number;
  movementPatternId?: string | null;
  trackedFields: TrackedField[];
  sets: ExerciseSetTarget[];
  goalWeight?: number | null;
  goalReps?: number | null;
}

// target_reps is free text (ranges like "8-10", tags like "AMRAP") since a
// coach can prescribe those — only coerce it into the numeric `reps` column
// when it's a plain number; otherwise the athlete fills in what they did.
function parseRepsTarget(text: string | null): number | null {
  if (!text) return null;
  const n = Number(text);
  return Number.isFinite(n) ? Math.round(n) : null;
}

export function StartWorkoutButton({
  workoutId,
  groupId,
  athleteId,
  exercises,
  loggedByCoach,
  sessionTypes,
}: {
  workoutId: string;
  groupId: string;
  athleteId: string;
  exercises: TemplateExercise[];
  // Set when a coach starts this session on a client's behalf (in-person
  // training) rather than the athlete starting it themselves — carried
  // through to workout_logs on completion so it can be badged in their
  // history instead of silently looking like their own entry.
  loggedByCoach?: boolean;
  // gym_owner_multi_trainer_session_tracking_real_prospect.md — only
  // meaningful for the coach-logged path (an athlete's own session never
  // spends a credit). Undefined/empty renders no picker at all, and the
  // session gets no session_type_id — complete_workout_session() already
  // treats that as the implicit default 1-credit training session, so a
  // coach who never creates a type sees nothing different here.
  sessionTypes?: { id: string; name: string; creditCost: number }[];
}) {
  const [starting, setStarting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sessionTypeId, setSessionTypeId] = useState<string>("");
  const router = useRouter();

  async function handleStart() {
    setStarting(true);
    setError(null);
    const supabase = createBrowserClient();

    // Calendar Spotter Phase 2 — link this session to the real booking
    // it fulfills, if one exists, so "booked 60 min, actually took 40"
    // becomes a real, queryable question later. A freeform/unbooked
    // session correctly finds nothing and stays null.
    const now = new Date();
    const windowStart = new Date(now.getTime() - 3 * 60 * 60000).toISOString();
    const windowEnd = new Date(now.getTime() + 3 * 60 * 60000).toISOString();
    const { data: candidateBookings } = await supabase
      .from("bookings")
      .select("id, start_at")
      .eq("athlete_id", athleteId)
      .eq("group_id", groupId)
      .eq("status", "confirmed")
      .gte("start_at", windowStart)
      .lte("start_at", windowEnd);
    const bookingId = findMatchingBookingId(
      (candidateBookings ?? []).map((b) => ({ id: b.id, startAt: new Date(b.start_at) })),
      now
    );

    const { data: session, error: sessionError } = await supabase
      .from("athlete_sessions")
      .insert({
        workout_id: workoutId,
        group_id: groupId,
        athlete_id: athleteId,
        logged_by_coach: loggedByCoach ?? false,
        session_type_id: sessionTypeId || null,
        booking_id: bookingId,
      })
      .select("id")
      .single();

    // Silently doing nothing here reads as "the button doesn't work" —
    // a real, reported symptom that turned out to actually be a stale
    // cached page hiding an already-started session (see
    // RefreshOnBfcacheRestore), but a genuine failure here (a network
    // blip, etc.) deserves the same visible feedback either way.
    if (sessionError || !session) {
      setStarting(false);
      setError("Couldn't start the workout — check your connection and try again.");
      return;
    }

    // Copy the template into the athlete's own mutable rows — later
    // swaps/additions here never touch group_workout_exercises. Batched
    // into two bulk inserts (one for every exercise, one for every set)
    // instead of two round trips per exercise — a 6-exercise workout was
    // previously 12 sequential requests blocking "Starting…" the whole time.
    const { data: insertedExercises } = await supabase
      .from("session_exercises")
      .insert(
        exercises.map((ex) => ({
          session_id: session.id,
          group_workout_exercise_id: ex.id,
          exercise_name: ex.exerciseName,
          exercise_order: ex.exerciseOrder,
          movement_pattern_id: ex.movementPatternId ?? null,
          tracked_fields: ex.trackedFields,
        }))
      )
      .select("id, group_workout_exercise_id");

    const sessionExerciseIdByTemplateId = new Map(
      (insertedExercises ?? []).map((r) => [r.group_workout_exercise_id, r.id])
    );

    const allSets = exercises.flatMap((ex) => {
      const sessionExerciseId = sessionExerciseIdByTemplateId.get(ex.id);
      if (!sessionExerciseId) return [];

      return ex.sets.length > 0
        ? ex.sets.map((target) => ({
            session_exercise_id: sessionExerciseId,
            set_order: target.setOrder,
            // An explicit per-set target_weight is a real coach decision,
            // so it still pre-fills for real. A progression-rule "goal"
            // (ex.goalWeight) is a computed guess, not something the
            // coach actually typed — it's now surfaced as the same kind
            // of grayed-out, swipe/tap-to-accept suggestion as the
            // correlating-history lookup (lib/set-suggestions.ts,
            // resolved fresh on the session page), rather than silently
            // committed as if the athlete had already reported it.
            weight: target.targetWeight ?? null,
            reps: parseRepsTarget(target.targetReps) ?? ex.goalReps ?? null,
          }))
        : [
            {
              session_exercise_id: sessionExerciseId,
              set_order: 0,
              weight: null,
              reps: ex.goalReps ?? null,
            },
          ];
    });

    if (allSets.length > 0) {
      await supabase.from("set_logs").insert(allSets);
    }

    router.push(`/sessions/${session.id}`);
  }

  return (
    <div>
      {loggedByCoach && sessionTypes && sessionTypes.length > 0 && (
        <div className="mb-2 flex items-center gap-2 justify-center">
          <label className="font-body text-[11px] text-steel uppercase tracking-wide">Session type</label>
          <select
            value={sessionTypeId}
            onChange={(e) => setSessionTypeId(e.target.value)}
            className="h-8 bg-surface border border-steel/30 text-chalk px-2 font-body text-xs focus:outline-none focus:border-rust"
          >
            <option value="">Training session (1 credit)</option>
            {sessionTypes.map((t) => (
              <option key={t.id} value={t.id}>
                {t.name} ({t.creditCost} {t.creditCost === 1 ? "credit" : "credits"})
              </option>
            ))}
          </select>
        </div>
      )}
      {error && (
        <p className="font-body text-xs text-rust mb-2 text-center" role="alert">
          {error}
        </p>
      )}
      <button
        type="button"
        onClick={handleStart}
        disabled={starting}
        className="w-full h-14 bg-rust text-graphite font-display uppercase text-lg font-bold disabled:opacity-40 active:bg-rust/80 transition-colors"
      >
        {starting ? "Starting…" : "Start workout"}
      </button>
    </div>
  );
}
