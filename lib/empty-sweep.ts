import type { SupabaseClient } from "@supabase/supabase-js";

// Empty things are not worth keeping (Ron): a day with no exercises and no name saying it is a rest day, and a program with nothing in it. Both are removed quietly, with safety: nothing that has a
// log, a session, a note, a scheduled date or a copy is ever removed, and nothing newly made is removed while the coach may still be working on it.

export const REST_DAY_TITLE = "Rest day";

// A day named "Rest day" (or just "Rest") with no exercises is a real rest day, kept and shown plainly.
export function isRestDayTitle(title: string | null | undefined): boolean {
  return /^rest(\s+day)?$/i.test((title ?? "").trim());
}

export interface EmptyDayRow {
  id: string;
  title: string | null;
  scheduledDate: string | null;
  createdAt: string;
  exercises: number;
  notes: number;
  sessions: number;
  logs: number;
  assignments: number;
}

// An empty day has no grace period (Ron: it is too easy to add one back): it goes the next time its program is opened. "Never while the builder is open" is kept by WHEN the sweep runs, not by a timer:
// only once, as the builder opens (the days it was opened with), so a day added while building can never be swept. The one exception is a program that is itself brand new (below).
export function isRemovableEmptyDay(d: EmptyDayRow): boolean {
  if (d.exercises > 0 || d.notes > 0 || d.sessions > 0 || d.logs > 0 || d.assignments > 0) return false;
  if (d.scheduledDate) return false;
  return !isRestDayTitle(d.title);
}

// A program made in the last few minutes is still being set up (a new program opens straight into the builder with its empty days to fill): its first open sweeps nothing.
const PROGRAM_BRAND_NEW_MS = 10 * 60000;
export function isBrandNewProgram(createdAt: string | null | undefined, now: Date = new Date()): boolean {
  if (!createdAt) return false;
  return now.getTime() - new Date(createdAt).getTime() < PROGRAM_BRAND_NEW_MS;
}

export interface EmptyProgramRow {
  id: string;
  ownerId: string;
  updatedAt: string;
  workoutsWithExercises: number;
  sessions: number;
  copies: number;
}

const PROGRAM_IDLE_MS = 24 * 3600000;

// Only the owner's own program, with no exercise in any day, no session, no copy, and untouched for 24 hours.
export function isRemovableEmptyProgram(p: EmptyProgramRow, viewerId: string, now: Date): boolean {
  if (p.ownerId !== viewerId) return false;
  if (p.workoutsWithExercises > 0 || p.sessions > 0 || p.copies > 0) return false;
  return now.getTime() - new Date(p.updatedAt).getTime() >= PROGRAM_IDLE_MS;
}

const count = (v: unknown): number => Number((v as { count?: number }[] | null)?.[0]?.count ?? 0);

// The empty days of one program among the ones the builder was opened with, removed as it opens. Returns the ids removed.
export async function sweepEmptyDays(supabase: SupabaseClient, programId: string, onlyIds: string[]): Promise<string[]> {
  try {
    if (onlyIds.length === 0) return [];
    const { data } = await supabase
      .from("workouts")
      .select("id, title, scheduled_date, created_at, group_workout_exercises(count), workout_notes(count), athlete_sessions(count), workout_logs(count), workout_assignments(count)")
      .eq("program_id", programId)
      .in("id", onlyIds);
    const ids = ((data ?? []) as any[])
      .filter((w) =>
        isRemovableEmptyDay({ id: w.id, title: w.title, scheduledDate: w.scheduled_date ?? null, createdAt: w.created_at, exercises: count(w.group_workout_exercises), notes: count(w.workout_notes), sessions: count(w.athlete_sessions), logs: count(w.workout_logs), assignments: count(w.workout_assignments) })
      )
      .map((w) => w.id as string);
    if (ids.length === 0) return [];
    const { error } = await supabase.from("workouts").delete().in("id", ids);
    return error ? [] : ids;
  } catch {
    return [];
  }
}

// The coach's own programs that are completely empty and idle, removed when he opens Programs.
export async function sweepEmptyPrograms(supabase: SupabaseClient, viewerId: string, groupIds: string[], now = new Date()): Promise<number> {
  try {
    if (groupIds.length === 0) return 0;
    const cutoff = new Date(now.getTime() - PROGRAM_IDLE_MS).toISOString();
    const { data } = await supabase
      .from("programs")
      .select("id, created_by, updated_at, workouts(id, group_workout_exercises(count), athlete_sessions(count))")
      .in("group_id", groupIds)
      .eq("created_by", viewerId)
      .lt("updated_at", cutoff);
    const candidates = ((data ?? []) as any[]).filter((p) => {
      const workouts = (p.workouts ?? []) as any[];
      return !workouts.some((w) => count(w.group_workout_exercises) > 0 || count(w.athlete_sessions) > 0);
    });
    if (candidates.length === 0) return 0;
    const ids = candidates.map((p) => p.id as string);
    const { data: copyRows } = await supabase.from("programs").select("source_program_id").in("source_program_id", ids);
    const withCopies = new Set(((copyRows ?? []) as { source_program_id: string }[]).map((r) => r.source_program_id));
    const removable = candidates
      .filter((p) =>
        isRemovableEmptyProgram({ id: p.id, ownerId: p.created_by, updatedAt: p.updated_at, workoutsWithExercises: 0, sessions: 0, copies: withCopies.has(p.id) ? 1 : 0 }, viewerId, now)
      )
      .map((p) => p.id as string);
    if (removable.length === 0) return 0;
    await supabase.from("programs").delete().in("id", removable);
    return removable.length;
  } catch {
    return 0;
  }
}
