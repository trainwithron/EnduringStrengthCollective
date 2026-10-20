import type { SupabaseClient } from "@supabase/supabase-js";
import type { SessionExerciseEntry } from "@/lib/types";
import type { WeightUnit } from "@/lib/units";
import { liftStoredFromInput } from "@/lib/lift-weight";
import { loggableReps, loggableWeight } from "@/lib/set-value-limits";

// Adds exercises, each with its sets, to a session that is under way: the wing-it logger (components/logging/wing-it-box.tsx) and the coach's Quick add (say it) both write through here,
// the same session_exercises / set_logs shape the logger's own "+ Add exercise" uses. Every one is is_added. The sets are only prefilled: a set counts as done when it is touched in the
// logger (exercise-set-grid.tsx), never just because it was added.

export interface ExerciseDraft {
  exerciseName: string;
  sets: number;
  reps: number | null;
  // Seconds per set for a timed exercise (a plank), else null.
  timeSeconds?: number | null;
  // As typed, in `weightUnit` (the client's own unit when none was said). Stored in pounds.
  weight: number | null;
  weightUnit: WeightUnit;
  rpe: number | null;
}

export const SET_LOG_RETURN = "id, set_order, weight, reps, rpe, rir, tempo, time_seconds, height, distance, rest_seconds, pace, status";

// The tracked fields for a draft: a timed exercise tracks time (and effort when said); weight and reps otherwise, with effort when said. Null keeps the table's default (reps, weight).
export function draftTrackedFields(d: Pick<ExerciseDraft, "timeSeconds" | "rpe">): string[] | null {
  if (d.timeSeconds != null) return ["time", ...(d.rpe != null ? ["rpe"] : [])];
  return d.rpe != null ? ["reps", "weight", "rpe"] : null;
}

// One set row for a draft: the weight in pounds (a kilogram value is converted), each value inside the database's limits or left blank.
export function draftSetRow(sessionExerciseId: string, i: number, d: ExerciseDraft): Record<string, unknown> {
  const pounds = d.weight != null && Number.isFinite(d.weight) ? liftStoredFromInput(d.weight, d.weightUnit) : null;
  return {
    session_exercise_id: sessionExerciseId,
    set_order: i,
    weight: loggableWeight(pounds),
    reps: loggableReps(d.reps),
    rpe: d.rpe,
    ...(d.timeSeconds != null ? { time_seconds: d.timeSeconds } : {}),
  };
}

export function failedLine(failed: number, total: number): string {
  return `${failed} of ${total} exercise${total === 1 ? "" : "s"} did not save. Check the list above and add what is missing.`;
}

export async function addSessionExercises(
  supabase: SupabaseClient,
  sessionId: string,
  startOrder: number,
  drafts: ExerciseDraft[]
): Promise<{ entries: SessionExerciseEntry[]; failed: number }> {
  const entries: SessionExerciseEntry[] = [];
  let order = startOrder;
  let failed = 0;
  for (const d of drafts) {
    const payload: Record<string, unknown> = { session_id: sessionId, exercise_name: d.exerciseName, exercise_order: order++, is_added: true };
    const tracked = draftTrackedFields(d);
    if (tracked) payload.tracked_fields = tracked;
    const { data: se } = await supabase.from("session_exercises").insert(payload).select("id, exercise_name, exercise_order, is_swapped, is_added, tracked_fields").single();
    if (!se) {
      failed++;
      continue;
    }
    const count = Math.max(1, Math.min(20, Math.round(d.sets)));
    const { data: sets, error: setsError } = await supabase
      .from("set_logs")
      .insert(Array.from({ length: count }, (_, i) => draftSetRow(se.id as string, i, d)))
      .select(SET_LOG_RETURN);
    if (setsError) failed++;
    entries.push({
      id: se.id as string,
      exerciseName: se.exercise_name as string,
      exerciseOrder: se.exercise_order as number,
      isSwapped: !!se.is_swapped,
      isAdded: !!se.is_added,
      trackedFields: se.tracked_fields,
      videoUrl: null,
      youtubeUrl: null,
      notes: null,
      sets: ((sets ?? []) as any[]).map((s) => ({
        id: s.id,
        setOrder: s.set_order,
        weight: s.weight,
        reps: s.reps,
        rpe: s.rpe,
        rir: s.rir,
        tempo: s.tempo,
        timeSeconds: s.time_seconds,
        height: s.height,
        distance: s.distance,
        restSeconds: s.rest_seconds,
        pace: s.pace,
        status: s.status,
      })),
    });
  }
  return { entries, failed };
}
