import type { SupabaseClient } from "@supabase/supabase-js";
import {
  getAllProgramWorkouts,
  getScheduledWorkouts,
  resolveDayWorkout,
  resolveNextUnloggedWorkout,
  type ActiveProgramInfo,
  type DayWorkoutInfo,
  type DayWorkoutStatus,
  type ScheduledWorkoutEntry,
} from "./athlete-day-schedule";
import { getActivePrograms, type ActiveProgram } from "./active-programs";
import { programHeading } from "./session-stack";
import { dateKeyOf } from "./athlete-day-schedule";
import type { Pickup } from "./program-pickup";
import { isLocked, unlockDate } from "./program-schedule";

// Several programs can be active for one client at once: a main program, a
// mobility program on off days, a warm-up flow. Each has its own schedule.
// These helpers resolve EVERY active program for a date, so the Home calendar
// shows all of them instead of whichever one a single-program lookup picked.

export interface ProgramDayContext {
  program: ActiveProgram;
  heading: string;
  // No start date or training days: the program runs as a playlist (next
  // unlogged workout), with no calendar dates.
  unscheduled: boolean;
  scheduled: ScheduledWorkoutEntry[];
  all: { id: string; title: string }[];
}

export async function loadProgramDayContexts(
  supabase: SupabaseClient,
  groupId: string,
  athleteId: string
): Promise<ProgramDayContext[]> {
  const programs = await getActivePrograms(supabase, groupId, athleteId);
  return Promise.all(
    programs.map(async (program) => {
      const unscheduled = !program.startDate || !program.trainingDays || program.trainingDays.length === 0;
      const info: ActiveProgramInfo = {
        id: program.id,
        startDate: program.startDate,
        trainingDays: program.trainingDays,
        visibilityWindow: program.visibilityWindow,
      };
      const [scheduled, all] = await Promise.all([
        unscheduled ? Promise.resolve([] as ScheduledWorkoutEntry[]) : getScheduledWorkouts(supabase, info),
        unscheduled ? getAllProgramWorkouts(supabase, program.id) : Promise.resolve([] as { id: string; title: string }[]),
      ]);
      return { program, heading: programHeading(program), unscheduled, scheduled, all };
    })
  );
}

export function contextWorkoutIds(contexts: ProgramDayContext[]): string[] {
  return contexts.flatMap((c) => (c.unscheduled ? c.all.map((w) => w.id) : c.scheduled.map((w) => w.workoutId)));
}

export interface DaySession extends DayWorkoutInfo {
  programId: string;
  heading: string;
  // The coach's note for a workout assigned to this one day.
  note?: string | null;
}

// A workout the coach put on ONE day for this client (workout_assignments). It replaces what the programs would give that day, the same rule "Today" already follows.
export interface AssignedWorkout {
  workoutId: string;
  title: string;
  note: string | null;
}
export const ASSIGNED_HEADING = "From your coach";

export async function loadAssignedWorkouts(supabase: SupabaseClient, athleteId: string, groupId: string, fromKey: string, toKey: string): Promise<Map<string, AssignedWorkout>> {
  const out = new Map<string, AssignedWorkout>();
  const { data } = await supabase
    .from("workout_assignments")
    .select("scheduled_date, workout_id, note, workouts ( title )")
    .eq("athlete_id", athleteId)
    .eq("group_id", groupId)
    .gte("scheduled_date", fromKey)
    .lte("scheduled_date", toKey);
  for (const row of (data ?? []) as unknown as Array<{ scheduled_date: string; workout_id: string | null; note: string | null; workouts: { title: string } | { title: string }[] | null }>) {
    if (!row.workout_id) continue;
    const w = Array.isArray(row.workouts) ? row.workouts[0] : row.workouts;
    out.set(row.scheduled_date, { workoutId: row.workout_id, title: w?.title ?? "Workout", note: row.note?.trim() || null });
  }
  return out;
}

// Every program that has something on `targetDate`: a workout to do, one that
// was done, one that was missed, or one not yet unlocked. A program resting
// that day contributes nothing, so a mobility program shows on days the main
// program is off.
// Where each program picks up (the workout right after the one done last, lib/program-pickup.ts) and whether a completion time falls on today. When given, TODAY's card for each program is that workout, not the one the
// calendar puts on today; other dates (Week and Month views) still follow the calendar.
export interface PickupToday {
  byProgram: ReadonlyMap<string, Pickup>;
  doneToday: (completedAtIso: string) => boolean;
}

function pickupSession(c: ProgramDayContext, pick: Pickup, today: Date, doneToday: (iso: string) => boolean): DayWorkoutInfo {
  if (pick.kind === "empty") return { status: "no-program", workoutId: null, title: null };
  // Finished today: the checked card for it (what comes next is the card under it tomorrow, or after Start another).
  if (pick.lastDone && pick.lastDoneAt && doneToday(pick.lastDoneAt)) return { status: "done", workoutId: pick.lastDone.id, title: pick.lastDone.title ?? "Workout" };
  if (pick.kind === "complete") return { status: "done", workoutId: null, title: null };
  const w = pick.workout;
  const title = w.title ?? "Workout";
  // The coach's "show days ahead" setting still holds a workout back until its date (only when the program has dates); it never decides which workout is the default.
  const entry = c.scheduled.find((s) => s.workoutId === w.id);
  if (entry && isLocked(entry.date, today, c.program.visibilityWindow)) {
    return { status: "locked", workoutId: w.id, title, unlocksOn: unlockDate(entry.date, c.program.visibilityWindow) };
  }
  return { status: "planned", workoutId: w.id, title };
}

export function resolveSessionsForDate(
  contexts: ProgramDayContext[],
  loggedIds: Set<string>,
  targetDate: Date,
  today: Date,
  isToday: boolean,
  assignedByDate?: Map<string, AssignedWorkout>,
  pickups?: PickupToday
): DaySession[] {
  const assigned = assignedByDate?.get(dateKeyOf(targetDate));
  if (assigned) {
    const todayStart = new Date(today);
    todayStart.setHours(0, 0, 0, 0);
    const dayStart = new Date(targetDate);
    dayStart.setHours(0, 0, 0, 0);
    const status: DayWorkoutStatus = loggedIds.has(assigned.workoutId) ? "done" : dayStart.getTime() < todayStart.getTime() ? "missed" : "planned";
    return [{ status, workoutId: assigned.workoutId, title: assigned.title, programId: "assigned", heading: ASSIGNED_HEADING, note: assigned.note }];
  }
  const out: DaySession[] = [];
  for (const c of contexts) {
    let info: DayWorkoutInfo;
    const pick = isToday ? pickups?.byProgram.get(c.program.id) : undefined;
    if (pick) {
      info = pickupSession(c, pick, today, pickups!.doneToday);
    } else if (c.unscheduled) {
      if (!isToday) continue;
      info = resolveNextUnloggedWorkout(c.all, loggedIds);
    } else {
      info = resolveDayWorkout(c.scheduled, loggedIds, targetDate, today, c.program.visibilityWindow);
    }
    if (!info.workoutId) continue;
    if (info.status === "rest" || info.status === "no-program" || info.status === "unscheduled") continue;
    out.push({ ...info, programId: c.program.id, heading: c.heading });
  }
  return out;
}

// The next day (within two weeks after today) that has a workout still to do, across every active program, or null.
// Playlist-style programs have no dates, so they never produce one.
export function findNextWorkoutDate(
  contexts: ProgramDayContext[],
  loggedIds: Set<string>,
  today: Date,
  daysAhead = 14
): Date | null {
  for (let i = 1; i <= daysAhead; i++) {
    const d = new Date(today);
    d.setDate(d.getDate() + i);
    const sessions = resolveSessionsForDate(contexts, loggedIds, d, today, false);
    if (sessions.some((s) => s.status === "planned" || s.status === "locked")) return d;
  }
  return null;
}

// "Tomorrow" or the weekday ("Thursday") for the line under a finished workout.
export function nextWorkoutLabel(next: Date | null, today: Date): string | null {
  if (!next) return null;
  const tomorrow = new Date(today);
  tomorrow.setDate(tomorrow.getDate() + 1);
  if (next.toDateString() === tomorrow.toDateString()) return "Tomorrow";
  return next.toLocaleDateString("en-US", { weekday: "long" });
}

// What a day looks like when there is nothing to list: no program at all, only
// playlist-style programs on a past or future date, or simply a rest day.
export function emptyDayInfo(contexts: ProgramDayContext[], isToday: boolean): DayWorkoutInfo {
  if (contexts.length === 0) return { status: "no-program", workoutId: null, title: null };
  if (contexts.every((c) => c.unscheduled)) {
    return isToday
      ? { status: "done", workoutId: null, title: null }
      : { status: "unscheduled", workoutId: null, title: null };
  }
  return { status: "rest", workoutId: null, title: null };
}

const STATUS_PRIORITY: Record<DayWorkoutStatus, number> = {
  planned: 5,
  locked: 4,
  missed: 3,
  done: 2,
  rest: 1,
  "no-program": 0,
  unscheduled: 0,
};

// One line for a week or month cell: the most actionable session that day.
export function summarizeSessions(sessions: DaySession[], fallback: DayWorkoutInfo): DayWorkoutInfo {
  if (sessions.length === 0) return fallback;
  const best = [...sessions].sort((a, b) => STATUS_PRIORITY[b.status] - STATUS_PRIORITY[a.status])[0];
  return { status: best.status, workoutId: best.workoutId, title: best.title };
}
