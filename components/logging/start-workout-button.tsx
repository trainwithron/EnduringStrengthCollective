"use client";

import { loggableReps, loggableWeight } from "@/lib/set-value-limits";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { createBrowserClient } from "@/lib/supabase/client";
import type { ExerciseSetTarget } from "@/lib/types";
import type { TrackedField } from "@/lib/exercise-fields";
import { findMatchingBookingId, SAME_DAY_TOLERANCE_MINUTES } from "@/lib/booking-session-link";
import { bookingCreditLine } from "@/lib/booking-credit-line";
import { localDayBounds } from "@/lib/timezone";

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
  coachTimezone,
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
  sessionTypes?: { id: string; name: string }[];
  // Shown in the line about the linked session ("it comes off Sawyer's sessions").
  clientName?: string;
  // The coach's time zone: "today" for finding the session this workout belongs to is the coach's day, not this phone's.
  coachTimezone?: string;
}) {
  const [starting, setStarting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sessionTypeId, setSessionTypeId] = useState<string>("");
  // The booking this session fulfills, if there is one (found before Start so the coach is told what will happen to the client's sessions). FIX 3: there is no "Use 1 session credit" box any more:
  // a workout the coach logs settles its booking once when it is finished (the database also matches one found later), and a workout with no booking is offered as a walk-in at the end.
  const [linked, setLinked] = useState<{ id: string; startAt: Date; prepaid: boolean } | null>(null);
  const [linkChecked, setLinkChecked] = useState(false);
  const router = useRouter();

  async function findLinkedBooking(supabase: ReturnType<typeof createBrowserClient>): Promise<{ id: string; startAt: Date; prepaid: boolean } | null> {
    // Calendar Spotter Phase 2 — link this session to the real booking it fulfills, if one exists, so "booked 60 min, actually took 40" becomes a real, queryable question later. A freeform/unbooked
    // session correctly finds nothing and stays null.
    // Any of the client's confirmed, not yet settled sessions TODAY on the coach's clock (this phone's), the nearest to now: a coach logging a 3:00 session at 8 AM still has it linked (and told so), and a booking
    // further away no longer sits unlinked beside a ticked credit box to be charged a second time when "Did this session happen?" is answered Yes.
    // Today on the COACH's clock (FIX 3), and a session paid for when it was booked counts too (it is settled once, never charged again).
    const now = new Date();
    const zone = coachTimezone || Intl.DateTimeFormat().resolvedOptions().timeZone;
    const day = localDayBounds(zone, now);
    const { data: candidateBookings } = await supabase
      .from("bookings")
      .select("id, start_at, credit_state")
      .eq("athlete_id", athleteId)
      .eq("group_id", groupId)
      .eq("status", "confirmed")
      .in("credit_state", ["unsettled", "prepaid"])
      .eq("no_show", false)
      .is("attended_at", null)
      .gte("start_at", day.startIso)
      .lt("start_at", day.endIso);
    const candidates = (candidateBookings ?? []).map((b) => ({ id: b.id as string, startAt: new Date(b.start_at as string), prepaid: b.credit_state === "prepaid" }));
    const id = findMatchingBookingId(candidates, now, SAME_DAY_TOLERANCE_MINUTES);
    return id ? candidates.find((c) => c.id === id) ?? null : null;
  }

  useEffect(() => {
    if (!loggedByCoach) return;
    let cancelled = false;
    findLinkedBooking(createBrowserClient())
      .then((b) => {
        if (cancelled) return;
        setLinked(b);
        setLinkChecked(true);
      })
      .catch(() => {
        if (!cancelled) setLinkChecked(true);
      });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [athleteId, groupId, loggedByCoach]);

  async function handleStart() {
    setStarting(true);
    setError(null);
    const supabase = createBrowserClient();

    // The booking found before Start, or looked up now if that read had not finished.
    const bookingId = (linkChecked ? linked : await findLinkedBooking(supabase))?.id ?? null;

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
            weight: loggableWeight(target.targetWeight),
            reps: loggableReps(parseRepsTarget(target.targetReps)),
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
      p_deduct_session_credit: false,
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
        deduct_session_credit: false,
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
          <select aria-label="Session type"
            value={sessionTypeId}
            onChange={(e) => setSessionTypeId(e.target.value)}
            className="h-11 bg-surface border border-steel/30 text-chalk px-2 font-body text-xs focus:outline-none focus:border-rust"
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
      {loggedByCoach && linked && (
        <p className="mb-2 text-center font-body text-xs text-steel">{bookingCreditLine(linked.startAt, clientName, linked.prepaid, coachTimezone)}</p>
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
