import { lbToKg, kgToLb, type WeightUnit } from "@/lib/units";

// Weights lifted (set weights, goals, last time, volume). STORAGE NEVER CHANGES: every lifted weight is kept in pounds, whoever lifted it, so teams, records and history compare like with like and nothing
// stored is ever rewritten. A client who picked kilograms (athlete_profile_details.weight_unit, the same setting as body weight) SEES and TYPES kilograms; the conversion happens only on the way to the screen and
// from what was typed. A value that was only displayed is never saved back: a cell left alone keeps its stored pounds exactly.

// The number shown for a stored weight: pounds as stored, or kilograms to one decimal ("61.2").
export function liftDisplayValue(lbs: number, unit: WeightUnit): number {
  if (unit === "lb") return lbs;
  return Math.round(lbToKg(lbs) * 10) / 10;
}

// What a person typed in their unit, as pounds to two decimals (the stored form).
export function liftStoredFromInput(typed: number, unit: WeightUnit): number {
  if (unit === "lb") return typed;
  return Math.round(kgToLb(typed) * 100) / 100;
}

export function liftUnitLabel(unit: WeightUnit): string {
  return unit === "kg" ? "kg" : "lb";
}

// "61.2 kg" / "135 lb" for a stored weight; whole numbers without ".0".
export function formatLift(lbs: number | null | undefined, unit: WeightUnit): string {
  if (lbs == null || !Number.isFinite(lbs)) return "";
  const v = liftDisplayValue(lbs, unit);
  return `${Number.isInteger(v) ? String(v) : v.toFixed(1)} ${liftUnitLabel(unit)}`;
}

// Total volume (weight x reps, stored in pounds) in the person's unit, rounded to a whole number.
export function formatVolume(volumeLbs: number, unit: WeightUnit): string {
  const v = unit === "kg" ? lbToKg(volumeLbs) : volumeLbs;
  return `${Math.round(v).toLocaleString()} ${liftUnitLabel(unit)}`;
}

// The text in a cell for a stored weight (no unit): "135" or "61.2".
export function liftCellText(lbs: number | null | undefined, unit: WeightUnit): string {
  if (lbs == null) return "";
  const v = liftDisplayValue(lbs, unit);
  return String(v);
}
