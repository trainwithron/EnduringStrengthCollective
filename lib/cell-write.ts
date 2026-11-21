import { TARGET_COLUMN, TARGET_PROP, fieldDef, type TrackedField } from "@/lib/exercise-fields";
import type { ExerciseSetTarget } from "@/lib/types";
import { parseWeightCell } from "@/lib/pct-of-max";

// What to save for a cell. A rest is its low end plus its high end (empty for a single time, so a range never survives a change to one time). "60-90" arrives as a range.
export function cellWrite(field: TrackedField, raw: string): { patch: Record<string, unknown>; local: Partial<ExerciseSetTarget> } {
  if (field === "rest") {
    const m = raw.match(/^(\d+)-(\d+)$/);
    const low = m ? Number(m[1]) : raw.trim() === "" ? null : Number(raw);
    const high = m ? Number(m[2]) : null;
    return { patch: { target_rest_seconds: low, target_rest_max_seconds: high }, local: { targetRestSeconds: low, targetRestMaxSeconds: high } };
  }
  // Weight takes "75%" as a percent of each athlete's max (wave 2 T3) or a plain number as a fixed weight; one clears the other.
  if (field === "weight") {
    const parsed = parseWeightCell(raw) ?? { pct: null, weight: raw.trim() === "" ? null : Number(raw) };
    return { patch: { target_weight: parsed.weight, target_pct_max: parsed.pct }, local: { targetWeight: parsed.weight, targetPctMax: parsed.pct } };
  }
  const def = fieldDef(field);
  const value = def.kind === "number" ? (raw.trim() === "" ? null : Number(raw)) : raw.trim() || null;
  return { patch: { [TARGET_COLUMN[field]]: value }, local: { [TARGET_PROP[field]]: value } as Partial<ExerciseSetTarget> };
}
