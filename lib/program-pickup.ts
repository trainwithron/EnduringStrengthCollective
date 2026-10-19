import type { SupabaseClient } from "@supabase/supabase-js";
import { readRowsByIds } from "@/lib/read-by-ids";

// "Pick up where you left off" (Ron, Oct 18): the DEFAULT workout of a program is the one right AFTER the most recently completed workout, in program order (week, then day). Not the first gap, and not tied to dates or
// training days: if the last one done was Week 3, Day 4, the default is Week 3, Day 5; if nothing is done it is Week 1, Day 1; after the very last workout the program is complete. Anything skipped stays reachable in the program view.
export interface PickupWorkout {
  id: string;
  week_number: number | null;
  day_index: number | null;
  title?: string | null;
}

export type Pickup =
  | { kind: "empty" }
  | { kind: "next"; workout: PickupWorkout; lastDone: PickupWorkout | null; lastDoneAt: string | null }
  | { kind: "complete"; lastDone: PickupWorkout; lastDoneAt: string };

export function orderWorkouts<T extends PickupWorkout>(workouts: T[]): T[] {
  return workouts.slice().sort((a, b) => (a.week_number ?? 1) - (b.week_number ?? 1) || (a.day_index ?? 0) - (b.day_index ?? 0) || a.id.localeCompare(b.id));
}

/** `doneAt`: workout id -> when it was completed (ISO). Only workouts of this program matter. */
export function pickUpWhereLeftOff(workouts: PickupWorkout[], doneAt: ReadonlyMap<string, string>): Pickup {
  const ordered = orderWorkouts(workouts);
  if (ordered.length === 0) return { kind: "empty" };
  let lastIdx = -1;
  let lastAt = "";
  ordered.forEach((w, i) => {
    const at = doneAt.get(w.id);
    // the most recently completed one wins; a tie goes to the later one in the program
    if (at && at >= lastAt) {
      lastAt = at;
      lastIdx = i;
    }
  });
  if (lastIdx < 0) return { kind: "next", workout: ordered[0], lastDone: null, lastDoneAt: null };
  const next = ordered[lastIdx + 1];
  if (!next) return { kind: "complete", lastDone: ordered[lastIdx], lastDoneAt: lastAt };
  return { kind: "next", workout: next, lastDone: ordered[lastIdx], lastDoneAt: lastAt };
}

export const weekOf = (w: PickupWorkout): number => w.week_number ?? 1;
export const dayOf = (w: PickupWorkout): number => w.day_index ?? 1;
export const weekDayLabel = (w: PickupWorkout): string => `Week ${weekOf(w)}, Day ${dayOf(w)}`;

/** The text for a program card: where they pick up, or that it is finished. */
export function pickupLabel(p: Pickup): string {
  if (p.kind === "empty") return "Nothing in it yet";
  if (p.kind === "complete") return "Program complete";
  return weekDayLabel(p.workout);
}

/** When each of these workouts was last completed by this athlete: a finished session, or a logged workout (history that was imported has a log and no session). */
export async function loadDoneAt(supabase: SupabaseClient, athleteId: string, workoutIds: string[]): Promise<{ doneAt: Map<string, string>; failed: boolean }> {
  const doneAt = new Map<string, string>();
  if (workoutIds.length === 0) return { doneAt, failed: false };
  const [sessions, logs] = await Promise.all([
    readRowsByIds(workoutIds, (ids) => (from, to) => supabase.from("athlete_sessions").select("id, workout_id, completed_at").eq("athlete_id", athleteId).eq("status", "completed").in("workout_id", ids).order("id").range(from, to)),
    readRowsByIds(workoutIds, (ids) => (from, to) => supabase.from("workout_logs").select("id, workout_id, created_at").eq("athlete_id", athleteId).in("workout_id", ids).order("id").range(from, to)),
  ]);
  const note = (workoutId: string, at: string | null) => {
    if (!at) {
      if (!doneAt.has(workoutId)) doneAt.set(workoutId, "0000-00-00");
      return;
    }
    const prev = doneAt.get(workoutId);
    if (!prev || at > prev) doneAt.set(workoutId, at);
  };
  for (const s of sessions.data) note(s.workout_id as string, (s.completed_at as string | null) ?? null);
  for (const l of logs.data) note(l.workout_id as string, (l.created_at as string | null) ?? null);
  return { doneAt, failed: !!sessions.error || !!logs.error };
}
