import type { SupabaseClient } from "@supabase/supabase-js";
import { computeScheduledDates, isLocked, isSameDay, type VisibilityWindow } from "./program-schedule";

// Shared program-schedule resolution for the athlete Home Day/Week/Month
// calendar — the same personal-over-shared precedence used by
// lib/todays-workout.ts and app/groups/[groupId]/page.tsx's old
// computeThisWeek, pulled out once so Day/Week/Month can all call it
// instead of three copies drifting apart.

export interface ActiveProgramInfo {
  id: string;
  startDate: string | null;
  trainingDays: number[] | null;
  visibilityWindow: VisibilityWindow;
}

export async function getActiveProgramForAthlete(
  supabase: SupabaseClient,
  groupId: string,
  athleteId: string
): Promise<ActiveProgramInfo | null> {
  const { data: personalProgram } = await supabase
    .from("programs")
    .select("id, start_date, training_days, visibility_window")
    .eq("group_id", groupId)
    .eq("athlete_id", athleteId)
    .eq("is_active", true)
    .maybeSingle();

  const { data: sharedProgram } = personalProgram
    ? { data: null }
    : await supabase
        .from("programs")
        .select("id, start_date, training_days, visibility_window")
        .eq("group_id", groupId)
        .is("athlete_id", null)
        .eq("is_active", true)
        .maybeSingle();

  const program = (personalProgram ?? sharedProgram) as {
    id: string;
    start_date: string | null;
    training_days: number[] | null;
    visibility_window: string | null;
  } | null;

  if (!program) return null;
  return {
    id: program.id,
    startDate: program.start_date,
    trainingDays: program.training_days,
    visibilityWindow: (program.visibility_window as VisibilityWindow) ?? "day",
  };
}

export interface ScheduledWorkoutEntry {
  workoutId: string;
  title: string;
  date: Date;
}

export async function getScheduledWorkouts(
  supabase: SupabaseClient,
  program: ActiveProgramInfo
): Promise<ScheduledWorkoutEntry[]> {
  if (!program.startDate || !program.trainingDays || program.trainingDays.length === 0) return [];
  const { data: workouts } = await supabase
    .from("workouts")
    .select("id, title")
    .eq("program_id", program.id)
    .order("week_number", { ascending: true })
    .order("day_index", { ascending: true });
  if (!workouts || workouts.length === 0) return [];

  const dateByDayId = computeScheduledDates(program.startDate, program.trainingDays, workouts);
  const result: ScheduledWorkoutEntry[] = [];
  for (const w of workouts) {
    const date = dateByDayId.get(w.id);
    if (date) result.push({ workoutId: w.id, title: w.title, date });
  }
  return result;
}

export type DayWorkoutStatus = "done" | "missed" | "planned" | "locked" | "rest" | "no-program";

export interface DayWorkoutInfo {
  status: DayWorkoutStatus;
  workoutId: string | null;
  title: string | null;
}

function startOfDay(d: Date): Date {
  const copy = new Date(d);
  copy.setHours(0, 0, 0, 0);
  return copy;
}

// Resolves one date's workout status against a program's full scheduled
// list — used identically for Day/Week/Month, so "what does this date
// show" can never drift between the three views. `today` and
// `targetDate` are both assumed already normalized to a specific zone's
// wall-clock reading (see lib/timezone.ts's nowInZone) by the caller.
export function resolveDayWorkout(
  scheduledWorkouts: ScheduledWorkoutEntry[],
  loggedIds: Set<string>,
  targetDate: Date,
  today: Date,
  visibilityWindow: VisibilityWindow
): DayWorkoutInfo {
  if (scheduledWorkouts.length === 0) {
    return { status: "no-program", workoutId: null, title: null };
  }
  const match = scheduledWorkouts.find((w) => isSameDay(w.date, targetDate));
  if (!match) {
    return { status: "rest", workoutId: null, title: null };
  }
  if (loggedIds.has(match.workoutId)) {
    return { status: "done", workoutId: match.workoutId, title: match.title };
  }
  if (startOfDay(targetDate).getTime() < startOfDay(today).getTime()) {
    return { status: "missed", workoutId: match.workoutId, title: match.title };
  }
  if (isLocked(match.date, today, visibilityWindow)) {
    return { status: "locked", workoutId: match.workoutId, title: match.title };
  }
  return { status: "planned", workoutId: match.workoutId, title: match.title };
}

export function dateKeyOf(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

export function parseDateKey(key: string): Date {
  return new Date(`${key}T00:00:00`);
}
