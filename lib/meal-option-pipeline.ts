import type { FoodRules } from "@/lib/allergen-check";
import { filterOptionsByRules } from "@/lib/plan-preference-check";
import { filterByMacroTolerance, type MacroTargets } from "@/lib/meal-option-tolerance";

// What happens to the AI's meal options after their ingredients were matched to real food data and their macros worked out from it, before any is offered to the coach:
//   1. the client's food rules: an option that names an allergen, a disliked food or breaks the diet is never returned, whatever the model did. The text checked is the option's name, each ingredient line AND the
//      real food each line was matched to; what is returned is the original verified option.
//   2. the numbers: the model is only ASKED to land near the target, so each remaining option's real macros are held to it (lib/meal-option-tolerance.ts).
// An option is counted once, under the first check it failed (a food-rule failure is never reported as a macro failure).
export interface CheckableOption {
  recipeName: string;
  ingredients: { rawLine: string; matchedDescription?: string | null }[];
  totalProtein: number;
  totalCarbs: number;
  totalFat: number;
  totalKcal: number;
}

export function checkMealOptions<T extends CheckableOption>(options: T[], rules: FoodRules | null, target: MacroTargets): { options: T[]; droppedForPreferences: number; droppedForMacros: number } {
  const checked = options.map((o) => ({
    recipeName: o.recipeName,
    ingredients: o.ingredients.flatMap((l) => [l.rawLine, ...(l.matchedDescription ? [l.matchedDescription] : [])]),
    original: o,
  }));
  const { kept, dropped } = rules ? filterOptionsByRules(checked, rules) : { kept: checked, dropped: [] as typeof checked };
  const { kept: onTarget, dropped: offTarget } = filterByMacroTolerance(
    kept.map((k) => k.original),
    target
  );
  return { options: onTarget, droppedForPreferences: dropped.length, droppedForMacros: offTarget.length };
}
