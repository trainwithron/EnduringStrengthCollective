import { TARGET_COLUMN, TARGET_PROP, fieldDef, type TrackedField } from "@/lib/exercise-fields";
import type { ExerciseSetTarget } from "@/lib/types";
import { parseWeightCell } from "@/lib/pct-of-max";

// What the builder says when a weight box holds something that is neither a weight nor a percent ("abc", "200%", "75 lb"): nothing is saved and the box goes back.
export const WEIGHT_CELL_MESSAGE = "Weight is a number like 135, or a percent of max like 75% (up to 150%).";

// What to save for a cell. A rest is its low end plus its high end (empty for a single time, so a range never survives a change to one time). "60-90" arrives as a range.
// Null when what was typed cannot be saved as it is (never a NaN written as an empty value: a typo must not clear a set's prescription).
export function cellWrite(field: TrackedField, raw: string): { patch: Record<string, unknown>; local: Partial<ExerciseSetTarget> } | null {
  if (field === "rest") {
    const m = raw.match(/^(\d+)-(\d+)$/);
    const low = m ? Number(m[1]) : raw.trim() === "" ? null : Number(raw);
    const high = m ? Number(m[2]) : null;
    if ((low !== null && !Number.isFinite(low)) || (high !== null && !Number.isFinite(high))) return null;
    return { patch: { target_rest_seconds: low, target_rest_max_seconds: high }, local: { targetRestSeconds: low, targetRestMaxSeconds: high } };
  }
  // Weight takes "75%" as a percent of each athlete's max (wave 2 T3) or a plain number as a fixed weight; one clears the other. Anything else is refused.
  if (field === "weight") {
    const parsed = parseWeightCell(raw);
    if (!parsed) return null;
    return { patch: { target_weight: parsed.weight, target_pct_max: parsed.pct }, local: { targetWeight: parsed.weight, targetPctMax: parsed.pct } };
  }
  const def = fieldDef(field);
  const value = def.kind === "number" ? (raw.trim() === "" ? null : Number(raw)) : raw.trim() || null;
  if (typeof value === "number" && !Number.isFinite(value)) return null;
  return { patch: { [TARGET_COLUMN[field]]: value }, local: { [TARGET_PROP[field]]: value } as Partial<ExerciseSetTarget> };
}
