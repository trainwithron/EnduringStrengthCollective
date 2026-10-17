// The most a logged set value can be. These are the database's own limits (migration 0389, the set_logs_values_in_range rule): a value past them is refused by the database, so the screen must refuse it
// first, in plain words, rather than letting it sit as "not saved" and block Complete workout. A test ties each number to the migration text.
export const SET_VALUE_LIMITS = {
  weightLb: 2000,
  reps: 1000,
  rpe: 10,
  timeSeconds: 172800,
  distance: 5000000,
} as const;

// 2,000 lb in kilograms, rounded DOWN so a typed kilogram value never converts to more than the pound limit.
export const WEIGHT_LIMIT_KG = Math.floor(SET_VALUE_LIMITS.weightLb * 0.45359237);

// A coach's target (a typo like 5280 lb in the builder) is copied into the client's set when a workout starts. A target past the database's limit would make the whole start fail, so it is left blank for
// the client to fill in (the coach's program still shows what was typed, and the client is not locked out of training by it).
export function loggableWeight(weight: number | null | undefined): number | null {
  return typeof weight === "number" && Number.isFinite(weight) && weight >= 0 && weight <= SET_VALUE_LIMITS.weightLb ? weight : null;
}
export function loggableReps(reps: number | null | undefined): number | null {
  return typeof reps === "number" && Number.isFinite(reps) && reps >= 0 && reps <= SET_VALUE_LIMITS.reps ? reps : null;
}
