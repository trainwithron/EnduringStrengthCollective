// The glue between the library-first builder and the meal-plan screens: a day of GeneratedMeal built from the library, the same day for a whole week, and the conversion of an
// option into the choice that is saved in a plan. The screens keep using GeneratedMeal / MealOption; only where the options come from changes.
import { buildMealSpecs, type GeneratedMeal, type MacroTargets, type MealOption, type MealSpec } from "@/lib/meal-engine";
import type { MealRecipeChoice } from "@/lib/meal-plan-assignment";
import { selectOptions, type SelectionContext } from "@/lib/library-selection";
import { buildWeekPlan, type WeekPlanResult, type WeekSlotSpec } from "@/lib/week-build";
import { roundMacros, type ScaledMeal } from "@/lib/scaled-meal";
import type { Slot } from "@/lib/meal-templates/types";

export function optionFromScaled(m: ScaledMeal): MealOption {
  return {
    recipeId: m.recipeId,
    recipeName: m.name,
    ingredients: m.displayLines,
    source: m.source,
    macros: roundMacros(m.macros),
    lines: m.lines,
    mainProtein: m.mainProtein,
    key: m.key,
  };
}

// The slots a spec may fill. buildMealSpecs only ever produces these four.
const slotOf = (spec: MealSpec): Slot => (spec.slot === "any" ? "lunch" : spec.slot);

export const specTarget = (spec: MealSpec) => ({ proteinG: spec.proteinTarget, carbsG: spec.carbsTarget, fatG: spec.fatTarget });

// One day from the library: each slot gets up to three options, and the meal says how many are missing so the screen can offer to generate them.
export function generateLibraryDay(macros: MacroTargets, mealCount: number, includeSnack: boolean, ctx: SelectionContext): GeneratedMeal[] {
  const used = new Set<string>(ctx.excludeKeys ?? []);
  return buildMealSpecs(macros, mealCount, includeSnack).map((spec) => {
    const sel = selectOptions(slotOf(spec), specTarget(spec), { ...ctx, excludeKeys: new Set(used) });
    sel.options.forEach((m) => used.add(m.key));
    return { spec, options: sel.options.map(optionFromScaled), restrictionDropped: false, shortfall: sel.shortfall, leftOutForRules: sel.leftOutForRules, featuredIndex: 0 };
  });
}

// A week from the library: for each date, the day's meals, with the option the client's card shows first. dayMacros(date) gives that day's targets (a carb-cycling client has a
// different one on training days).
export function generateLibraryWeek(args: {
  dates: string[];
  dayMacros: (date: string) => MacroTargets;
  mealCount: number;
  includeSnack: boolean;
  ctx: SelectionContext;
  rotateFeatured?: boolean;
}): Record<string, GeneratedMeal[]> {
  const specsByDate = new Map<string, MealSpec[]>();
  const specsFor = (date: string): WeekSlotSpec[] => {
    const specs = buildMealSpecs(args.dayMacros(date), args.mealCount, args.includeSnack);
    specsByDate.set(date, specs);
    return specs.map((spec) => ({ id: spec.id, slot: slotOf(spec), title: spec.title, target: specTarget(spec) }));
  };
  const plan: WeekPlanResult = buildWeekPlan({ dates: args.dates, specsFor, ctx: args.ctx, rotateFeatured: args.rotateFeatured });
  const out: Record<string, GeneratedMeal[]> = {};
  for (const date of args.dates) {
    const specs = specsByDate.get(date) ?? [];
    out[date] = (plan[date] ?? []).map((r, i) => ({
      spec: specs[i],
      options: r.options.map(optionFromScaled),
      restrictionDropped: false,
      shortfall: r.shortfall,
      leftOutForRules: r.leftOutForRules,
      featuredIndex: r.featuredIndex,
    }));
  }
  return out;
}

// What is saved in a plan for one option. Everything the library-first builder knows is kept (structured lines, macros, source), so the client's card and the food-rule re-check
// have it; an older option without them saves exactly what it always did.
export function choiceFromOption(opt: MealOption): MealRecipeChoice {
  const macros = opt.macros ?? (opt.verifiedMacros ? { proteinG: opt.verifiedMacros.protein, carbsG: opt.verifiedMacros.carbs, fatG: opt.verifiedMacros.fat, calories: opt.verifiedMacros.kcal } : undefined);
  return {
    recipeId: opt.recipeId ?? null,
    recipeName: opt.recipeName ?? null,
    ingredients: opt.ingredients ?? [],
    isAi: opt.isAi,
    ...(opt.source ? { source: opt.source } : opt.isAi ? { source: "ai" as const } : {}),
    ...(opt.lines ? { lines: opt.lines } : {}),
    ...(macros ? { macros: roundMacros(macros) } : {}),
    ...(opt.mainProtein !== undefined ? { mainProtein: opt.mainProtein } : {}),
    ...(opt.key ? { key: opt.key } : {}),
  };
}
