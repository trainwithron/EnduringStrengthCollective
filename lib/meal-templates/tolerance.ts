import { caloriesOf, type Macros } from "./macros";

// How close a meal must land to its slot's target to be shown. The numbers are the design's (7.3): calories and protein within 10 percent, protein never below 90
// percent of the target, carbs and fat each within 15 percent. One addition the port makes (listed in the port log): carbs and fat also pass when they are within
// MIN_ABS_TOLERANCE_G grams, because 15 percent of a 6 g target is under a gram, finer than the food table can promise.
export const CALORIE_TOLERANCE = 0.1;
export const PROTEIN_TOLERANCE = 0.1;
export const PROTEIN_FLOOR_RATIO = 0.9;
export const CARB_FAT_TOLERANCE = 0.15;
export const MIN_ABS_TOLERANCE_G = 5;

export interface SlotTarget {
  proteinG: number;
  carbsG: number;
  fatG: number;
}

export interface ToleranceResult {
  ok: boolean;
  // Which parts missed, for a message or a log.
  misses: string[];
}

const within = (actual: number, target: number, pct: number, absFloor = 0) => Math.abs(actual - target) <= Math.max(target * pct, absFloor);

export function checkTolerance(actual: Macros, target: SlotTarget): ToleranceResult {
  const misses: string[] = [];
  const targetCal = caloriesOf(target.proteinG, target.carbsG, target.fatG);
  if (!within(actual.calories, targetCal, CALORIE_TOLERANCE)) misses.push("calories");
  if (!within(actual.proteinG, target.proteinG, PROTEIN_TOLERANCE) || actual.proteinG < PROTEIN_FLOOR_RATIO * target.proteinG) misses.push("protein");
  if (!within(actual.carbsG, target.carbsG, CARB_FAT_TOLERANCE, MIN_ABS_TOLERANCE_G)) misses.push("carbs");
  if (!within(actual.fatG, target.fatG, CARB_FAT_TOLERANCE, MIN_ABS_TOLERANCE_G)) misses.push("fat");
  return { ok: misses.length === 0, misses };
}

// One number for "how far off", used to pick the best of several tries: the sum of each macro's relative error against its own tolerance (1 = exactly at the limit).
export function missScore(actual: Macros, target: SlotTarget): number {
  const targetCal = caloriesOf(target.proteinG, target.carbsG, target.fatG);
  const rel = (a: number, t: number, pct: number, absFloor = 0) => Math.abs(a - t) / Math.max(t * pct, absFloor, 1e-9);
  return (
    rel(actual.calories, targetCal, CALORIE_TOLERANCE) +
    rel(actual.proteinG, target.proteinG, PROTEIN_TOLERANCE) +
    rel(actual.carbsG, target.carbsG, CARB_FAT_TOLERANCE, MIN_ABS_TOLERANCE_G) +
    rel(actual.fatG, target.fatG, CARB_FAT_TOLERANCE, MIN_ABS_TOLERANCE_G)
  );
}
