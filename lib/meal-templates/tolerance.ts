import { caloriesOf, type Macros } from "./macros";

// How close a meal must land to its slot's target to be shown. The design's numbers: calories and protein within 10 percent, protein never below 90 percent of the
// target, carbs and fat each within 15 percent. For a SMALL target 15 percent is finer than a food table can promise (15 percent of 6 g is under a gram), so carbs and fat
// also get a small absolute allowance, kept proportional to the target so a keto slot is never allowed to double its carbs: allowance = the larger of 15 percent of the
// target and clamp(0.4 x target, 2 g, 5 g). A 4 g carb target allows 2 g (so up to 6 g, not 9), 6 g allows 2.4, 12 g allows 4.8, 0 g allows 2, and a big target is unchanged.
export const CALORIE_TOLERANCE = 0.1;
export const PROTEIN_TOLERANCE = 0.1;
export const PROTEIN_FLOOR_RATIO = 0.9;
export const CARB_FAT_TOLERANCE = 0.15;
export const MIN_ABS_ALLOWANCE_G = 2;
export const MAX_ABS_ALLOWANCE_G = 5;
export const ABS_ALLOWANCE_RATIO = 0.4;

export const absAllowanceG = (target: number): number => Math.min(MAX_ABS_ALLOWANCE_G, Math.max(MIN_ABS_ALLOWANCE_G, ABS_ALLOWANCE_RATIO * target));
export const carbFatAllowanceG = (target: number): number => Math.max(CARB_FAT_TOLERANCE * target, absAllowanceG(target));

// On a LOW-carb target (20 g or less in a meal, 50 g or less in a day: keto and carnivore) fewer carbs than the target is never a miss: the carbs are a ceiling to stay
// under, not a number to reach, and a zero-carb meal on a 6 g slot is on plan. Only the upper side counts there. On a normal target both sides count.
export const LOW_CARB_MEAL_G = 20;
export const LOW_CARB_DAY_G = 50;
const carbsOff = (actual: number, target: number, allowance: number, lowCarbBelow: number): boolean =>
  actual - target > allowance || (target > lowCarbBelow && target - actual > allowance);

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

export function checkTolerance(actual: Macros, target: SlotTarget): ToleranceResult {
  const misses: string[] = [];
  const targetCal = caloriesOf(target.proteinG, target.carbsG, target.fatG);
  if (Math.abs(actual.calories - targetCal) > CALORIE_TOLERANCE * targetCal) misses.push("calories");
  if (Math.abs(actual.proteinG - target.proteinG) > PROTEIN_TOLERANCE * target.proteinG || actual.proteinG < PROTEIN_FLOOR_RATIO * target.proteinG) misses.push("protein");
  if (carbsOff(actual.carbsG, target.carbsG, carbFatAllowanceG(target.carbsG), LOW_CARB_MEAL_G)) misses.push("carbs");
  if (Math.abs(actual.fatG - target.fatG) > carbFatAllowanceG(target.fatG)) misses.push("fat");
  return { ok: misses.length === 0, misses };
}

// One number for "how far off", used to pick the best of several tries: the sum of each macro's error against its own allowance (1 = exactly at the limit).
export function missScore(actual: Macros, target: SlotTarget): number {
  const targetCal = caloriesOf(target.proteinG, target.carbsG, target.fatG);
  const rel = (a: number, t: number, allowance: number) => Math.abs(a - t) / Math.max(allowance, 1e-9);
  return (
    rel(actual.calories, targetCal, CALORIE_TOLERANCE * targetCal) +
    rel(actual.proteinG, target.proteinG, PROTEIN_TOLERANCE * target.proteinG) +
    rel(target.carbsG <= LOW_CARB_MEAL_G ? Math.max(actual.carbsG, target.carbsG) : actual.carbsG, target.carbsG, carbFatAllowanceG(target.carbsG)) +
    rel(actual.fatG, target.fatG, carbFatAllowanceG(target.fatG))
  );
}

// The whole day, across the meals actually chosen. A meal inside its own tolerance can still be a little high every time, and for carbs on a keto plan that adds up (four
// meals each 2 g over is 8 g on a 25 g budget), so the day is checked on its own: calories within 8 percent, protein within 10 percent, carbs and fat within 15 percent or
// clamp(0.1 x target, 3 g, 15 g), whichever is larger.
export const DAY_CALORIE_TOLERANCE = 0.08;
export const DAY_PROTEIN_TOLERANCE = 0.1;
export const dayCarbFatAllowanceG = (target: number): number => Math.max(CARB_FAT_TOLERANCE * target, Math.min(15, Math.max(3, 0.1 * target)));

export function checkDayTolerance(meals: Macros[], dayTarget: SlotTarget): ToleranceResult {
  const total = meals.reduce(
    (t, m) => ({ proteinG: t.proteinG + m.proteinG, carbsG: t.carbsG + m.carbsG, fatG: t.fatG + m.fatG }),
    { proteinG: 0, carbsG: 0, fatG: 0 }
  );
  const misses: string[] = [];
  const targetCal = caloriesOf(dayTarget.proteinG, dayTarget.carbsG, dayTarget.fatG);
  if (Math.abs(caloriesOf(total.proteinG, total.carbsG, total.fatG) - targetCal) > DAY_CALORIE_TOLERANCE * targetCal) misses.push("calories");
  if (Math.abs(total.proteinG - dayTarget.proteinG) > DAY_PROTEIN_TOLERANCE * dayTarget.proteinG) misses.push("protein");
  if (carbsOff(total.carbsG, dayTarget.carbsG, dayCarbFatAllowanceG(dayTarget.carbsG), LOW_CARB_DAY_G)) misses.push("carbs");
  if (Math.abs(total.fatG - dayTarget.fatG) > dayCarbFatAllowanceG(dayTarget.fatG)) misses.push("fat");
  return { ok: misses.length === 0, misses };
}
