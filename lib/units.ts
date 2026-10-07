// Body-weight and height units. Storage never changes: body_weight_logs.weight stays POUNDS and heights stay centimetres. The client's unit setting changes only what is
// shown and what a person types. A converted value is never re-saved: a weight typed in kilograms is stored once as pounds (two decimals) and everything else is display
// rounding, so 80.0 kg does not drift to 79.99 after a round trip.

export type WeightUnit = "lb" | "kg";

export const KG_PER_LB = 0.45359237;

export const lbToKg = (lb: number): number => lb * KG_PER_LB;
export const kgToLb = (kg: number): number => kg / KG_PER_LB;

export const isWeightUnit = (v: unknown): v is WeightUnit => v === "lb" || v === "kg";
export const asWeightUnit = (v: unknown): WeightUnit => (v === "kg" ? "kg" : "lb");
export const weightUnitLabel = (unit: WeightUnit): string => (unit === "kg" ? "kg" : "lb");

const round = (n: number, places: number): number => {
  const f = 10 ** places;
  return Math.round(n * f) / f;
};

// The number shown for a stored weight in pounds: pounds or kilograms, one decimal.
export function displayWeightValue(lbs: number, unit: WeightUnit): number {
  return round(unit === "kg" ? lbToKg(lbs) : lbs, 1);
}

// "180.5 lb" or "81.9 kg". A whole number shows without ".0".
export function formatWeight(lbs: number | null | undefined, unit: WeightUnit): string {
  if (lbs == null || !Number.isFinite(lbs)) return "";
  const v = displayWeightValue(lbs, unit);
  return `${Number.isInteger(v) ? v.toFixed(0) : v.toFixed(1)} ${weightUnitLabel(unit)}`;
}

// What a person typed ("81.9", "81,9", "180 lb") read as POUNDS to two decimals, or null when it is not a believable body weight (20 to 1000 lb).
export function parseWeightInput(text: string, unit: WeightUnit): number | null {
  const cleaned = text.trim().toLowerCase().replace(/,/g, ".").replace(/(kg|kgs|lb|lbs)$/, "").trim();
  if (!/^\d+(\.\d+)?$/.test(cleaned)) return null;
  const n = Number(cleaned);
  if (!Number.isFinite(n) || n <= 0) return null;
  const lbs = round(unit === "kg" ? kgToLb(n) : n, 2);
  return lbs >= 20 && lbs <= 1000 ? lbs : null;
}

const CM_PER_INCH = 2.54;

// Feet and whole inches for a height in centimetres (11.6 inches carries to the next foot).
export function cmToFtIn(cm: number): { ft: number; inches: number } {
  const totalInches = Math.round(cm / CM_PER_INCH);
  return { ft: Math.floor(totalInches / 12), inches: totalInches % 12 };
}

export function ftInToCm(ft: number, inches: number): number {
  return round((ft * 12 + inches) * CM_PER_INCH, 1);
}

// Height follows the weight setting: feet and inches for pounds, centimetres for kilograms.
export function formatHeight(cm: number | null | undefined, unit: WeightUnit): string {
  if (cm == null || !Number.isFinite(cm)) return "";
  if (unit === "kg") return `${Math.round(cm)} cm`;
  const { ft, inches } = cmToFtIn(cm);
  return `${ft}'${inches}"`;
}

// Height typed as centimetres ("178"), or feet and inches ("5'10", "5 10", "5ft 10in"), read as centimetres. Null when it is not between 90 and 250 cm.
export function parseHeightInput(text: string, unit: WeightUnit): number | null {
  const t = text.trim().toLowerCase().replace(/,/g, ".");
  let cm: number | null = null;
  const ftIn = /^(\d)\s*(?:'|ft|feet|\s)\s*(\d{1,2}(?:\.\d+)?)?\s*(?:"|in|inches)?$/.exec(t);
  if (unit === "lb" && ftIn) cm = ftInToCm(Number(ftIn[1]), ftIn[2] ? Number(ftIn[2]) : 0);
  else if (/^\d+(\.\d+)?\s*(cm)?$/.test(t)) cm = round(Number(t.replace(/cm/, "").trim()), 1);
  return cm != null && cm >= 90 && cm <= 250 ? cm : null;
}
