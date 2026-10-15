// Pounds or kilograms in imported history. The app stores pounds. A file (or a typed entry) is read as the unit it SAYS it is in (a header like "Weight (kg)", a value like "100kg" or "220 lb",
// FitPros's lb or kg after a weight); when it does not say, the coach's choice (pounds unless they pick kilograms) decides. Kilograms are converted when saved. A file that mixes units is never
// guessed at: the rows that disagree with the rest are imported flagged as unclear. Pure.

export type WeightUnit = "lb" | "kg";

export const KG_TO_LB = 2.2046226218;

const KG = /(^|[^a-z])(kgs?|kilograms?|kilos?)(?![a-z])/;
const LB = /(^|[^a-z])(lbs?|pounds?)(?![a-z])/;

// The unit a piece of text names: "Weight (kg)", "100kg", "220 lbs". Both named ("lb/kg") or neither is not a unit.
export function unitFromText(text: string | null | undefined): WeightUnit | null {
  const t = (text ?? "").toLowerCase();
  const kg = KG.test(t);
  const lb = LB.test(t);
  if (kg === lb) return null;
  return kg ? "kg" : "lb";
}

export function poundsFrom(value: number, unit: WeightUnit): number {
  return unit === "kg" ? Math.round(value * KG_TO_LB * 10) / 10 : value;
}

// One weight cell: the number, and the unit written in it if any ("100kg" -> 100, kg; "225" -> 225, no unit). A cell with no number is null.
export function parseWeightCell(raw: string | null | undefined): { value: number | null; unit: WeightUnit | null } {
  const text = (raw ?? "").toString().trim();
  if (!text) return { value: null, unit: null };
  const match = /\d+(?:[.,]\d+)?/.exec(text.replace(/,(?=\d{3}(?!\d))/g, ""));
  const value = match ? Number(match[0].replace(",", ".")) : null;
  return { value: value != null && Number.isFinite(value) ? value : null, unit: unitFromText(text) };
}

export interface UnitPlan {
  unit: WeightUnit; // the unit the file is read in
  source: "header" | "cells" | "choice";
  mixed: boolean; // some cell names a different unit than the rest
}

// Which unit a whole file is in. The header wins, then the units written in the cells (the more common one), then the coach's choice. Mixed when any cell names the other unit.
export function planUnits(args: { headerUnit: WeightUnit | null; cellUnits: (WeightUnit | null)[]; chosen: WeightUnit }): UnitPlan {
  const named = args.cellUnits.filter((u): u is WeightUnit => u != null);
  const kgCount = named.filter((u) => u === "kg").length;
  const lbCount = named.length - kgCount;
  let unit: WeightUnit;
  let source: UnitPlan["source"];
  if (args.headerUnit) {
    unit = args.headerUnit;
    source = "header";
  } else if (named.length > 0 && kgCount !== lbCount) {
    unit = kgCount > lbCount ? "kg" : "lb";
    source = "cells";
  } else {
    unit = args.chosen;
    source = "choice";
  }
  return { unit, source, mixed: named.some((u) => u !== unit) };
}

export const MIXED_UNITS_REASON = "Weight unit differs from the rest of the file";

// One weight, in pounds. A cell that names its own unit is converted by it; if that is not the file's unit the weight is flagged (kept, converted by what it says, left out of the numbers until the
// coach counts it).
export function weightInPounds(cell: { value: number | null; unit: WeightUnit | null }, plan: UnitPlan): { pounds: number | null; unclearReason: string | null } {
  if (cell.value == null) return { pounds: null, unclearReason: null };
  const effective = cell.unit ?? plan.unit;
  return { pounds: poundsFrom(cell.value, effective), unclearReason: cell.unit != null && cell.unit !== plan.unit ? MIXED_UNITS_REASON : null };
}

export const WEIGHT_UNIT_LABEL: Record<WeightUnit, string> = { lb: "Pounds", kg: "Kilograms" };
