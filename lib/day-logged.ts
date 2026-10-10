import { ACTUAL_COLUMN, type TrackedField } from "@/lib/exercise-fields";
import { formatRest } from "@/lib/rest-time";
import type { ExerciseSetTarget } from "@/lib/types";

// What the coach's builder shows for a client's own program besides the prescription: the numbers the client actually logged (past days) and the gray weight suggestion (days not
// done yet). Pure shaping; the route does the reading.

export type LoggedValues = Partial<Record<TrackedField, string | number>>;
// exercise slot (group_workout_exercise_id) -> set number -> the numbers logged for that set
export type LoggedByExercise = Record<string, Record<number, LoggedValues>>;

const FIELDS = Object.keys(ACTUAL_COLUMN) as TrackedField[];

// Completed set rows (as read from set_logs, with the slot they were logged against) -> the logged numbers by slot and set number. A set the client skipped has no row and stays blank.
export function shapeLogged(rows: { set_order: number; session_exercises: { group_workout_exercise_id: string | null } | null; [column: string]: unknown }[]): LoggedByExercise {
  const out: LoggedByExercise = {};
  for (const row of rows) {
    const slot = row.session_exercises?.group_workout_exercise_id;
    if (!slot) continue;
    const values: LoggedValues = {};
    for (const field of FIELDS) {
      const v = row[ACTUAL_COLUMN[field]];
      if (v !== null && v !== undefined && v !== "") values[field] = v as string | number;
    }
    (out[slot] ??= {})[row.set_order] = values;
  }
  return out;
}

export function hasAnyLogged(logged: LoggedByExercise): boolean {
  return Object.values(logged).some((bySet) => Object.keys(bySet).length > 0);
}

// How a logged number reads in a cell (time and rest as m:ss, like the prescription).
export function loggedText(values: LoggedValues | undefined, field: TrackedField): string {
  const v = values?.[field];
  if (v === undefined) return "";
  if ((field === "rest" || field === "time") && typeof v === "number") return v > 0 ? formatRest(v) : "";
  return String(v);
}

// "Prescribed 3 x 5 @ 135": the small line under logged sets, so the plan is never lost behind what happened. Empty when nothing was prescribed.
export function prescribedSummary(sets: Pick<ExerciseSetTarget, "targetReps" | "targetWeight">[]): string {
  const withTarget = sets.filter((s) => s.targetReps || s.targetWeight != null);
  if (withTarget.length === 0) return "";
  const part = (s: Pick<ExerciseSetTarget, "targetReps" | "targetWeight">) => `${s.targetReps ?? "?"}${s.targetWeight != null ? ` @ ${s.targetWeight}` : ""}`;
  const parts = withTarget.map(part);
  const same = parts.every((p) => p === parts[0]);
  return same ? `Prescribed ${withTarget.length} x ${parts[0]}` : `Prescribed ${parts.join(", ")}`;
}
