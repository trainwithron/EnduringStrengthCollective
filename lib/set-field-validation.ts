import type { TrackedField } from "./exercise-fields";

export type SetFieldValidation =
  | { ok: true; value: number | string | null }
  | { ok: false; message: string };

// Limits are deliberately generous except where the scale is a real standard
// (RPE is 1-10, RIR is 0-10, reps are whole numbers). The point is to catch
// typos like "89" for RPE before they are saved and counted, and to say so,
// instead of silently reverting or saving nonsense.
const NUMBER_RULES: Partial<Record<TrackedField, { min: number; max: number; label: string; integer?: boolean }>> = {
  reps: { min: 0, max: 1000, label: "Reps", integer: true },
  weight: { min: 0, max: 3000, label: "Weight" },
  rpe: { min: 1, max: 10, label: "RPE" },
  rir: { min: 0, max: 10, label: "RIR" },
  time: { min: 0, max: 86400, label: "Time" },
  height: { min: 0, max: 1000, label: "Height" },
  distance: { min: 0, max: 100000, label: "Distance" },
  rest: { min: 0, max: 36000, label: "Rest" },
};

export function validateSetFieldInput(field: TrackedField, raw: string): SetFieldValidation {
  const text = raw.trim();
  if (text === "") return { ok: true, value: null };

  const rule = NUMBER_RULES[field];
  if (!rule) return { ok: true, value: text };

  const n = Number(text);
  if (!Number.isFinite(n)) return { ok: false, message: `${rule.label} needs a number.` };
  if (rule.integer && !Number.isInteger(n)) return { ok: false, message: `${rule.label} must be a whole number.` };
  if (n < rule.min || n > rule.max) {
    return { ok: false, message: `${rule.label} must be between ${rule.min} and ${rule.max}.` };
  }
  return { ok: true, value: n };
}
