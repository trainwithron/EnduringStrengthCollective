import type { ExerciseSetTarget } from "./types";

// The fixed set of trackable per-set fields — shared by the coach's builder
// cards and the athlete's logging screen so both stay in sync. Not a fully
// dynamic custom-field system: a new field type is a small migration, not a
// runtime concept, matching how weight/reps/RPE already work.
export type TrackedField =
  | "reps"
  | "weight"
  | "rpe"
  | "rir"
  | "tempo"
  | "time"
  | "height"
  | "distance";

export const TRACKED_FIELD_DEFS: { key: TrackedField; label: string; kind: "number" | "text" }[] = [
  { key: "reps", label: "Reps", kind: "text" },
  { key: "weight", label: "lb", kind: "number" },
  { key: "rpe", label: "RPE", kind: "number" },
  { key: "rir", label: "RIR", kind: "number" },
  { key: "tempo", label: "Tempo", kind: "text" },
  { key: "time", label: "Sec", kind: "number" },
  { key: "height", label: "Height", kind: "number" },
  { key: "distance", label: "Distance", kind: "number" },
];

export const DEFAULT_TRACKED_FIELDS: TrackedField[] = ["reps", "weight", "rpe"];

export function fieldDef(key: TrackedField) {
  return TRACKED_FIELD_DEFS.find((f) => f.key === key)!;
}

// Sort a set of tracked-field keys into the canonical display order above.
export function orderTrackedFields(fields: TrackedField[]): TrackedField[] {
  const order = TRACKED_FIELD_DEFS.map((f) => f.key);
  return fields.slice().sort((a, b) => order.indexOf(a) - order.indexOf(b));
}

// group_workout_exercise_sets column + ExerciseSetTarget property per field.
export const TARGET_COLUMN: Record<TrackedField, string> = {
  reps: "target_reps",
  weight: "target_weight",
  rpe: "target_rpe",
  rir: "target_rir",
  tempo: "target_tempo",
  time: "target_time_seconds",
  height: "target_height",
  distance: "target_distance",
};

export const TARGET_PROP: Record<TrackedField, string> = {
  reps: "targetReps",
  weight: "targetWeight",
  rpe: "targetRpe",
  rir: "targetRir",
  tempo: "targetTempo",
  time: "targetTimeSeconds",
  height: "targetHeight",
  distance: "targetDistance",
};

// set_logs column + SetLogEntry property per field (actual logged values).
export const ACTUAL_COLUMN: Record<TrackedField, string> = {
  reps: "reps",
  weight: "weight",
  rpe: "rpe",
  rir: "rir",
  tempo: "tempo",
  time: "time_seconds",
  height: "height",
  distance: "distance",
};

export const ACTUAL_PROP: Record<TrackedField, string> = {
  reps: "reps",
  weight: "weight",
  rpe: "rpe",
  rir: "rir",
  tempo: "tempo",
  time: "timeSeconds",
  height: "height",
  distance: "distance",
};

// Shared shape mapper: a raw group_workout_exercise_sets row (snake_case,
// from any select()) to the camelCase ExerciseSetTarget the builder UI uses.
export function mapSetRow(row: {
  id: string;
  set_order: number;
  target_reps: string | null;
  target_weight: number | null;
  target_rpe: number | null;
  target_rir: number | null;
  target_tempo: string | null;
  target_time_seconds: number | null;
  target_height: number | null;
  target_distance: number | null;
  rep_min?: number | null;
  rep_max?: number | null;
}): ExerciseSetTarget {
  return {
    id: row.id,
    setOrder: row.set_order,
    targetReps: row.target_reps,
    targetWeight: row.target_weight,
    targetRpe: row.target_rpe,
    targetRir: row.target_rir,
    targetTempo: row.target_tempo,
    targetTimeSeconds: row.target_time_seconds,
    targetHeight: row.target_height,
    targetDistance: row.target_distance,
    repMin: row.rep_min ?? null,
    repMax: row.rep_max ?? null,
  };
}

export const SET_ROW_SELECT =
  "id, set_order, target_reps, target_weight, target_rpe, target_rir, target_tempo, target_time_seconds, target_height, target_distance, rep_min, rep_max";
