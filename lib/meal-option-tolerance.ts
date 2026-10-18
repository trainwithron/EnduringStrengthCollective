// Is a meal option, with its macros worked out from real food data, close enough to the meal's target to be offered?
// The prompt asks the AI to land "within about 10%", but nothing checked it: an option 40 g of carbs short was shown as a pick for the meal. This is that check. A macro is close enough when it is within 10% of its
// target or within 4 g of it, whichever is larger (so a 5 g fat target is not held to half a gram), and the calories are within 10% or 40 kcal. An option that fails is not offered; the coach can ask again.
export interface MacroTargets {
  proteinG: number;
  carbsG: number;
  fatG: number;
}

export interface OptionMacros {
  totalProtein: number;
  totalCarbs: number;
  totalFat: number;
  totalKcal: number;
}

export const MACRO_TOLERANCE_PCT = 0.1;
export const MACRO_TOLERANCE_MIN_G = 4;
export const KCAL_TOLERANCE_MIN = 40;

export function targetKcal(t: MacroTargets): number {
  return t.proteinG * 4 + t.carbsG * 4 + t.fatG * 9;
}

const within = (actual: number, target: number, floor: number): boolean => Number.isFinite(actual) && Math.abs(actual - target) <= Math.max(target * MACRO_TOLERANCE_PCT, floor);

export function withinMacroTolerance(option: OptionMacros, target: MacroTargets): boolean {
  return (
    within(option.totalProtein, target.proteinG, MACRO_TOLERANCE_MIN_G) &&
    within(option.totalCarbs, target.carbsG, MACRO_TOLERANCE_MIN_G) &&
    within(option.totalFat, target.fatG, MACRO_TOLERANCE_MIN_G) &&
    within(option.totalKcal, targetKcal(target), KCAL_TOLERANCE_MIN)
  );
}

export function filterByMacroTolerance<T extends OptionMacros>(options: T[], target: MacroTargets): { kept: T[]; dropped: T[] } {
  const kept: T[] = [];
  const dropped: T[] = [];
  for (const o of options) (withinMacroTolerance(o, target) ? kept : dropped).push(o);
  return { kept, dropped };
}
