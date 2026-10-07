import type { SetLogEntry } from "@/lib/types";

// Taking a set off an exercise while logging ("Sets [-] 4 [+]"). Only the LAST set comes off (a middle set that was not done is skipped, not
// removed), an exercise always keeps at least one set, and a set the athlete has already logged asks first and can be put back for a few seconds.

export const UNDO_REMOVE_SET_MS = 6000;

export function canRemoveSet(sets: Pick<SetLogEntry, "id">[]): boolean {
  return sets.length > 1;
}

export function lastSet<T extends Pick<SetLogEntry, "setOrder">>(sets: T[]): T | null {
  let best: T | null = null;
  for (const s of sets) if (best === null || s.setOrder > best.setOrder) best = s;
  return best;
}

type WorkFields = Pick<
  SetLogEntry,
  "status" | "weightConfirmed" | "weight" | "reps" | "rpe" | "rir" | "tempo" | "timeSeconds" | "height" | "distance" | "restSeconds" | "pace" | "targetWeight" | "targetReps"
>;

// A set counts as logged work (so removing it asks first, and can be undone) when the athlete put anything into it: it was completed or skipped on purpose,
// a weight was committed, or any number or note they typed is there, even if they never tapped complete. Starting a workout pre-fills only the program's own
// weight and reps, so those two count only when they differ from the prescription; a set nobody touched is NOT logged work and removing it is free.
export function setHasLoggedWork(set: WorkFields): boolean {
  if (set.status === "completed" || set.status === "skipped" || set.weightConfirmed) return true;
  if (set.rpe != null || set.rir != null || set.tempo != null || set.timeSeconds != null || set.height != null || set.distance != null || set.restSeconds != null || set.pace != null) {
    return true;
  }
  if (set.reps != null && (set.targetReps == null || set.reps !== set.targetReps)) return true;
  if (set.weight != null && (set.targetWeight == null || set.weight !== set.targetWeight)) return true;
  return false;
}

export function removeSetConfirmText(position: number): string {
  return `Remove set ${position}? It's already logged.`;
}

// The row to put back if the athlete taps Undo: the same id and values, so nothing about the set changes. Timestamps are not kept in the app's
// state, so a completed set gets a fresh completed_at.
export function restoreSetRow(set: SetLogEntry, sessionExerciseId: string, now: Date = new Date()): Record<string, unknown> {
  return {
    id: set.id,
    session_exercise_id: sessionExerciseId,
    set_order: set.setOrder,
    weight: set.weight,
    reps: set.reps,
    rpe: set.rpe,
    rir: set.rir,
    tempo: set.tempo,
    time_seconds: set.timeSeconds,
    height: set.height,
    distance: set.distance,
    rest_seconds: set.restSeconds,
    pace: set.pace,
    status: set.status,
    weight_confirmed: !!set.weightConfirmed,
    ...(set.status === "completed" ? { completed_at: now.toISOString() } : {}),
  };
}

// "Prescribed 4" beside the stepper, only when what the athlete has now differs from what the coach prescribed.
export function prescribedNote(prescribedSetCount: number | null | undefined, currentCount: number): string | null {
  if (prescribedSetCount == null || prescribedSetCount < 1) return null;
  return prescribedSetCount === currentCount ? null : `Prescribed ${prescribedSetCount}`;
}
