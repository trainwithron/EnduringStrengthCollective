import type { TrackedField } from "./exercise-fields";
import { SET_VALUE_LIMITS, WEIGHT_LIMIT_KG } from "./set-value-limits";

export type SetFieldValidation =
  | { ok: true; value: number | string | null }
  | { ok: false; message: string };

// Limits are deliberately generous except where the scale is a real standard
// (RPE is 1-10, RIR is 0-10, reps are whole numbers). The point is to catch
// typos like "89" for RPE before they are saved and counted, and to say so,
// instead of silently reverting or saving nonsense.
const NUMBER_RULES: Partial<Record<TrackedField, { min: number; max: number; label: string; integer?: boolean }>> = {
  reps: { min: 0, max: SET_VALUE_LIMITS.reps, label: "Reps", integer: true },
  weight: { min: 0, max: SET_VALUE_LIMITS.weightLb, label: "Weight" },
  rpe: { min: 1, max: 10, label: "RPE" },
  rir: { min: 0, max: 10, label: "RIR" },
  time: { min: 0, max: Math.min(86400, SET_VALUE_LIMITS.timeSeconds), label: "Time" },
  height: { min: 0, max: 1000, label: "Height" },
  distance: { min: 0, max: Math.min(100000, SET_VALUE_LIMITS.distance), label: "Distance" },
  rest: { min: 0, max: 36000, label: "Rest" },
};

// `unit` is the unit the person types a weight in: the limit is the database's, 2,000 pounds, which is 907 kilograms.
export function validateSetFieldInput(field: TrackedField, raw: string, unit: "lb" | "kg" = "lb"): SetFieldValidation {
  const text = raw.trim();
  if (text === "") return { ok: true, value: null };

  const base = NUMBER_RULES[field];
  if (!base) return { ok: true, value: text };
  const rule = field === "weight" && unit === "kg" ? { ...base, max: WEIGHT_LIMIT_KG } : base;

  const n = Number(text);
  if (!Number.isFinite(n)) return { ok: false, message: `${rule.label} needs a number.` };
  if (rule.integer && !Number.isInteger(n)) return { ok: false, message: `${rule.label} must be a whole number.` };
  if (n < rule.min || n > rule.max) {
    return { ok: false, message: `${rule.label} must be ${rule.min} to ${rule.max}.` };
  }
  return { ok: true, value: n };
}
