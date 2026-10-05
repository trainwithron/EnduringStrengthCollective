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
  clientName,
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
  // Shown in the credit choice below ("from Sawyer's balance").
  clientName?: string;
}) {
  const [starting, setStarting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sessionTypeId, setSessionTypeId] = useState<string>("");
  // A coach logging in person never spends a session credit unless they
  // choose to here (default OFF) — see migration 0231.
  const [deductCredit, setDeductCredit] = useState(false);
  const selectedCost = sessionTypes?.find((t) => t.id === sessionTypeId)?.creditCost ?? 1;
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

    // The sets each template exercise starts with. An explicit per-set
    // target_weight/target_reps is a real coach decision, so it still
    // pre-fills for real. A progression-rule "goal" (Exercise Progressions'
    // live computed suggestion) is never committed here as if the athlete
    // had already reported it — it's already shown as the pre-start "Goal: ..."
    // preview (pre-start-exercise-row.tsx); the athlete reports what they
    // actually did, for both fields.
    function setsFor(ex: TemplateExercise) {
      return ex.sets.length > 0
        ? ex.sets.map((target) => ({
            set_order: target.setOrder,
            weight: target.targetWeight ?? null,
            reps: parseRepsTarget(target.targetReps),
          }))
        : [{ set_order: 0, weight: null, reps: null }];
    }

    // One atomic call: session + exercises + sets all land together or not at
    // all, and starting again after a dropped connection reuses (and fills in)
    // the same session instead of leaving an empty one behind. Falls back to
    // the old three-step insert only where the function isn't installed yet.
    const { data: sessionId, error: rpcError } = await supabase.rpc("start_workout_session", {
      p_workout_id: workoutId,
      p_group_id: groupId,
      p_athlete_id: athleteId,
      p_logged_by_coach: loggedByCoach ?? false,
      p_session_type_id: sessionTypeId || null,
      p_deduct_session_credit: !!loggedByCoach && deductCredit,
      p_booking_id: bookingId,
      p_exercises: exercises.map((ex) => ({
        group_workout_exercise_id: ex.id,
        exercise_name: ex.exerciseName,
        exercise_order: ex.exerciseOrder,
        movement_pattern_id: ex.movementPatternId ?? null,
        tracked_fields: ex.trackedFields,
        sets: setsFor(ex),
      })),
    });

    if (!rpcError && sessionId) {
      router.push(`/sessions/${sessionId}`);
      return;
    }

    const functionMissing =
      rpcError?.code === "PGRST202" || /could not find the function/i.test(rpcError?.message ?? "");
    if (!functionMissing) {
      setStarting(false);
      setError("Couldn't start the workout — check your connection and try again.");
      return;
    }

    const { data: session, error: sessionError } = await supabase
      .from("athlete_sessions")
      .insert({
        workout_id: workoutId,
        group_id: groupId,
        athlete_id: athleteId,
        logged_by_coach: loggedByCoach ?? false,
        session_type_id: sessionTypeId || null,
        deduct_session_credit: !!loggedByCoach && deductCredit,
        booking_id: bookingId,
      })
      .select("id")
      .single();

    if (sessionError || !session) {
      setStarting(false);
      setError("Couldn't start the workout — check your connection and try again.");
      return;
    }

    // Copy the template into the athlete's own mutable rows — later
    // swaps/additions here never touch group_workout_exercises.
    const { data: insertedExercises, error: exError } = await supabase
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
      return setsFor(ex).map((st) => ({ session_exercise_id: sessionExerciseId, ...st }));
    });

    let setsError = null;
    if (allSets.length > 0) {
      ({ error: setsError } = await supabase.from("set_logs").insert(allSets));
    }

    // A half-built session is worse than none: say so instead of opening it.
    if (exError || setsError) {
      setStarting(false);
      setError("The workout only partly started. Tap Start workout again to finish setting it up.");
      return;
    }

    router.push(`/sessions/${session.id}`);
  }

  return (
    <div>
      {loggedByCoach && sessionTypes && sessionTypes.length > 0 && (
        <div className="mb-2 flex items-center gap-2 justify-center">
          <label className="font-body text-xs text-steel uppercase tracking-wide">Session type</label>
          <select
            value={sessionTypeId}
            onChange={(e) => setSessionTypeId(e.target.value)}
            className="h-8 bg-surface border border-steel/30 text-chalk px-2 font-body text-xs focus:outline-none focus:border-rust"
          >
            <option value="">Training session</option>
            {sessionTypes.map((t) => (
              <option key={t.id} value={t.id}>
                {t.name}
              </option>
            ))}
          </select>
        </div>
      )}
      {loggedByCoach && (
        <label className="mb-2 flex items-center justify-center gap-2 font-body text-xs text-steel">
          <input
            type="checkbox"
            checked={deductCredit}
            onChange={(e) => setDeductCredit(e.target.checked)}
            className="h-4 w-4 accent-rust"
          />
          Use {selectedCost} session {selectedCost === 1 ? "credit" : "credits"}
          {clientName ? " from " + clientName + "'s balance" : " from their balance"}
        </label>
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
