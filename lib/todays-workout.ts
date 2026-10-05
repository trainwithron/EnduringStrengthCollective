import type { SupabaseClient } from "@supabase/supabase-js";
import { computeScheduledDates, isLocked, isSameDay } from "./program-schedule";
import { dateKeyInZone, getGroupCoachTimezone, nowInZone } from "./timezone";
import { getActivePrograms, type ActiveProgram } from "./active-programs";
import { buildSessionStack, type DaySessionCard, type ProgramToday, type StackFallback } from "./session-stack";

export type TodaysWorkoutResult =
  | { status: "ready"; workoutId: string }
  | { status: "locked"; unlocksOn: Date; workoutId: string }
  | { status: "done" }
  | { status: "no-program" };

// What one program has for the athlete today. A program whose scheduled
// workout for today is already logged reports "done_today" (so the Today view
// can keep a checked card for it); otherwise the same rules as before: today's
// scheduled workout, else the next unlogged one, held back until its date
// arrives. With a start date and training days set, nothing is "ready" before
// its own day.
async function resolveProgramToday(
  supabase: SupabaseClient,
  program: ActiveProgram,
  athleteId: string,
  timezone: string
): Promise<ProgramToday> {
  const base: Omit<ProgramToday, "kind" | "workoutId" | "title" | "unlocksOn"> = {
    programId: program.id,
    name: program.name,
    label: program.label,
    sortOrder: program.sortOrder,
    createdAt: program.createdAt,
  };

  const { data: workouts } = await supabase
    .from("workouts")
    .select("id, title, scheduled_date")
    .eq("program_id", program.id)
    .order("week_number", { ascending: true })
    .order("day_index", { ascending: true });

  if (!workouts || workouts.length === 0) {
    return { ...base, kind: "empty", workoutId: null, title: null, unlocksOn: null };
  }

  const { data: logs } = await supabase
    .from("workout_logs")
    .select("workout_id")
    .eq("athlete_id", athleteId)
    .in(
      "workout_id",
      workouts.map((w) => w.id)
    );

  const loggedIds = new Set((logs ?? []).map((l) => l.workout_id));
  const next = workouts.find((w) => !loggedIds.has(w.id));

  if (program.startDate && program.trainingDays && program.trainingDays.length > 0) {
    const scheduledDateByDayId = computeScheduledDates(
      program.startDate,
      program.trainingDays,
      workouts.map((w) => ({ id: w.id, scheduledDate: w.scheduled_date }))
    );
    const now = nowInZone(timezone);

    // Prefer whichever workout's own computed date is literally today — the
    // same thing the calendar page highlights as "Today" — over the rolling
    // "next unlogged in sequence" pick below. Without this, one skipped day
    // leaves the Workout tab handing back that stale overdue workout while the
    // calendar has already moved on.
    const todaysWorkout = workouts.find((w) => {
      const d = scheduledDateByDayId.get(w.id);
      return d && isSameDay(d, now);
    });
    if (todaysWorkout) {
      if (!loggedIds.has(todaysWorkout.id)) {
        return { ...base, kind: "ready", workoutId: todaysWorkout.id, title: todaysWorkout.title, unlocksOn: null };
      }
      // Done for today. Work out what would be next, so the single-workout callers can keep
      // handing the athlete the following workout when it is already unlocked.
      let after: ProgramToday["after"] = null;
      if (next) {
        const nextDate = scheduledDateByDayId.get(next.id);
        after = isLocked(nextDate, now, program.visibilityWindow)
          ? { kind: "locked", workoutId: next.id, unlocksOn: nextDate ?? null }
          : { kind: "ready", workoutId: next.id, unlocksOn: null };
      }
      return { ...base, kind: "done_today", workoutId: todaysWorkout.id, title: todaysWorkout.title, unlocksOn: null, after };
    }

    // No workout falls on today (a rest day for THIS program): fall back to
    // the rolling next-unlogged pick, gated by the same lock check.
    if (!next) return { ...base, kind: "all_done", workoutId: null, title: null, unlocksOn: null };
    const scheduledDate = scheduledDateByDayId.get(next.id);
    if (isLocked(scheduledDate, now, program.visibilityWindow)) {
      return { ...base, kind: "locked", workoutId: next.id, title: next.title, unlocksOn: scheduledDate ?? null };
    }
    return { ...base, kind: "ready", workoutId: next.id, title: next.title, unlocksOn: null };
  }

  if (!next) return { ...base, kind: "all_done", workoutId: null, title: null, unlocksOn: null };
  return { ...base, kind: "ready", workoutId: next.id, title: next.title, unlocksOn: null };
}

export interface TodaysSessions {
  // One card per active program that has something to start or was just done,
  // in the coach's order. Empty on a day with nothing for any program.
  cards: DaySessionCard[];
  // Why there are no cards (the earliest unlock, everything done, no program).
  fallback: StackFallback;
  // A coach-assigned workout for today beats everything; when set, it is the
  // only card.
  overrideWorkoutId: string | null;
  // Each active program's own result, in the coach's order.
  perProgram: ProgramToday[];
}

// Everything the athlete has today across ALL their active programs. A second
// program (mobility on off days, a warm-up flow) never hides the main one.
export async function getTodaysSessions(
  supabase: SupabaseClient,
  { groupId, athleteId }: { groupId: string; athleteId: string }
): Promise<TodaysSessions> {
  // "Today" for a program's own schedule is the group's coach's real
  // wall-clock day, not the server's UTC clock — see lib/timezone.ts.
  const timezone = await getGroupCoachTimezone(supabase, groupId);
  const todayKey = dateKeyInZone(timezone);

  const { data: override } = await supabase
    .from("workout_assignments")
    .select("workout_id")
    .eq("athlete_id", athleteId)
    .eq("scheduled_date", todayKey)
    .maybeSingle();

  if (override?.workout_id) {
    return {
      cards: [],
      fallback: { status: "done" },
      overrideWorkoutId: override.workout_id,
      perProgram: [],
    };
  }

  const programs = await getActivePrograms(supabase, groupId, athleteId);
  const perProgram = await Promise.all(programs.map((p) => resolveProgramToday(supabase, p, athleteId, timezone)));
  const { cards, fallback } = buildSessionStack(perProgram);
  return { cards, fallback, overrideWorkoutId: null, perProgram };
}

// "Today's workout": the single next thing to start. Kept for the places that
// need exactly one (a redirect, a roster "due" flag). It is now the FIRST
// ready session across all active programs in the coach's order, so a personal
// mobility program can no longer push the shared main program out of sight.
export async function getTodaysWorkoutId(
  supabase: SupabaseClient,
  { groupId, athleteId }: { groupId: string; athleteId: string }
): Promise<TodaysWorkoutResult> {
  return workoutResultFromSessions(await getTodaysSessions(supabase, { groupId, athleteId }));
}

// The single-workout answer drawn from an already-loaded set of sessions.
export function workoutResultFromSessions(sessions: TodaysSessions): TodaysWorkoutResult {

  // A coach-assigned workout for today always wins — an explicit override is
  // never locked, whatever a program's schedule says.
  if (sessions.overrideWorkoutId) {
    return { status: "ready", workoutId: sessions.overrideWorkoutId };
  }

  const firstReady = sessions.cards.find((c) => c.status === "ready");
  if (firstReady) return { status: "ready", workoutId: firstReady.workoutId };

  if (sessions.cards.length > 0) {
    // Today's list is all done. As before, offer the next workout if one is already unlocked,
    // otherwise say when it unlocks.
    const afters = sessions.perProgram.map((p) => p.after).filter((a): a is NonNullable<typeof a> => !!a);
    const readyAfter = afters.find((a) => a.kind === "ready");
    if (readyAfter) return { status: "ready", workoutId: readyAfter.workoutId };
    const lockedAfter = afters
      .filter((a) => a.unlocksOn)
      .sort((a, b) => (a.unlocksOn as Date).getTime() - (b.unlocksOn as Date).getTime())[0];
    if (lockedAfter) {
      return { status: "locked", unlocksOn: lockedAfter.unlocksOn as Date, workoutId: lockedAfter.workoutId };
    }
    return { status: "done" };
  }

  return sessions.fallback;
}
