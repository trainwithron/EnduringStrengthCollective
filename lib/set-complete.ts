import { ACTUAL_COLUMN, DEFAULT_TRACKED_FIELDS, orderTrackedFields, type TrackedField } from "./exercise-fields";
import { classifyEquipmentType } from "./equipment-classifier";

// When a logged set counts as done (Ron, Sep 12: "The big ones are weights and reps are the two nonnegotiables that have to be there. Outside of that, everything else should be optional ... we need to be able to leave
// certain fields blank."). Weight and reps are the only fields that ever block: a bodyweight movement needs reps alone, and RPE, RIR, tempo, time, height, distance, pace and rest never block anything. An exercise that
// tracks neither weight nor reps (a timed hold, a distance run) is done once any one of its fields has a value.
export interface SetValues {
  weight?: unknown;
  reps?: unknown;
  [prop: string]: unknown;
}

function has(v: unknown): boolean {
  return v !== null && v !== undefined && v !== "";
}

export function isSetFilled(set: SetValues, trackedProps: string[], weightOptional: boolean): boolean {
  const tracksWeight = trackedProps.includes("weight") && !weightOptional;
  const tracksReps = trackedProps.includes("reps");
  if (tracksWeight || tracksReps) return (!tracksWeight || has(set.weight)) && (!tracksReps || has(set.reps));
  return trackedProps.some((p) => has(set[p]));
}

// Reading a PAST set (a finished workout's history): done when it was marked done, or when it has the values the logger itself requires (isSetFilled, with the exercise's own tracked
// fields; weight optional for a bodyweight movement). Sets logged under the old checkbox rule kept their weight and reps but stayed "pending", and were read as skipped: a coach was
// told a first exercise "averaged 46% of its sets" when every set was there (Oct 20). A set marked skipped is never done. The live logger is unchanged (it flips the status itself).
export interface PastSetRow {
  status?: string | null;
  [column: string]: unknown;
}
export interface PastSetExercise {
  tracked_fields?: string[] | null;
  exercise_name?: string | null;
}
export function pastSetDone(row: PastSetRow, exercise: PastSetExercise | null | undefined): boolean {
  if (row.status === "completed") return true;
  if (row.status === "skipped") return false;
  const fields = orderTrackedFields(((exercise?.tracked_fields as TrackedField[] | null | undefined) ?? DEFAULT_TRACKED_FIELDS).filter((f): f is TrackedField => f in ACTUAL_COLUMN));
  // Rest is never something that makes a set done (the grid leaves a prescribed rest out too), unless it is all the exercise tracks.
  const counted = fields.length > 1 ? fields.filter((f) => f !== "rest") : fields;
  return isSetFilled(row, counted.map((f) => ACTUAL_COLUMN[f]), classifyEquipmentType(exercise?.exercise_name ?? "") === "bodyweight");
}
