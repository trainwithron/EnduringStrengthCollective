// Nutrition Spotter (nutrition_spotter_idea.md / nutrition_spotter_
// scoping_sept15.md) — the real, currently-invisible gap: a meal plan's
// own stored macros (meal_plans.macros) never get compared against the
// athlete's most recent CONFIRMED check-in (nutrition_checkins.new_
// calories/protein_g/carbs_g/fat_g — the check-in engine's own real
// output, already persisted, no recompute needed here). If a coach runs
// a check-in but the athlete's active plan isn't regenerated to match,
// nothing today says so.
//
// Deliberately a value comparison, not a timestamp comparison — meal_
// plans.created_at doesn't update on a re-save via upsert's ON CONFLICT
// path (only the columns actually in the payload do), so "is the plan
// older than the check-in" isn't a reliable question to ask with the
// current schema. "Does the plan's own calorie number match what the
// latest check-in said the target should be" is the real, robust
// question, and it's answerable directly from data already fetched on
// the nutrition page.

export interface MealPlanMacrosShape {
  daily?: { calories: number };
  train?: { calories: number };
  rest?: { calories: number };
}

export interface StaleMealPlanResult {
  isStale: boolean;
  planCalories: number | null;
  targetCalories: number;
  diffKcal: number;
}

// A carb-cycling plan splits the daily baseline into train/rest
// buckets around the SAME weekly calorie budget (lib/meal-engine.ts's
// computeCarbCyclingTargets) — the average of the two buckets is the
// real daily baseline to compare against a check-in's own single flat
// target, not either bucket alone.
export function extractPlanCalories(macros: MealPlanMacrosShape | null | undefined): number | null {
  if (!macros) return null;
  if (macros.daily) return macros.daily.calories;
  if (macros.train && macros.rest) return Math.round((macros.train.calories + macros.rest.calories) / 2);
  return null;
}

// 50 kcal tolerance — small enough to catch a real drift, large enough
// to absorb rounding noise already present in how these numbers get
// computed and re-displayed (calorie math throughout this app rounds
// at several separate steps).
const STALE_TOLERANCE_KCAL = 50;

export function detectStaleMealPlan(
  planMacros: MealPlanMacrosShape | null | undefined,
  targetCalories: number
): StaleMealPlanResult {
  const planCalories = extractPlanCalories(planMacros);
  const diffKcal = planCalories === null ? 0 : Math.abs(planCalories - targetCalories);
  return {
    isStale: planCalories !== null && diffKcal > STALE_TOLERANCE_KCAL,
    planCalories,
    targetCalories,
    diffKcal,
  };
}

// nutrition_spotter_scoping_sept15.md's three remaining checks — same
// deterministic, no-LLM, "flag, never auto-fix" discipline as check #2
// above and Programming Spotter's own governing pattern.

// Check #1 — macro-sum mismatch. lib/meal-plan-assignment.ts's
// MealEntryPayload carries its own proteinTarget/carbsTarget/fatTarget
// per meal, computed once at generation time via buildMealSpecs'
// largest-remainder distribute() — which by construction always sums
// back to the day's total at the moment of generation. Real drift is
// still possible afterward: a plan's meal_count can change without a
// full regeneration, or an older/manually-edited row can predate that
// guarantee. This is the same "catch a structural problem regardless of
// how it got there" spirit as Programming Spotter, not an assumption
// that drift is common.
export interface MacroSumMismatchResult {
  isMismatched: boolean;
  summedProtein: number;
  summedCarbs: number;
  summedFat: number;
  targetProtein: number;
  targetCarbs: number;
  targetFat: number;
}

// 5g tolerance — largest-remainder rounding can be off by a gram or two
// per macro even when nothing is actually wrong.
const MACRO_SUM_TOLERANCE_G = 5;

export function detectMacroSumMismatch(
  mealEntries: { proteinTarget: number; carbsTarget: number; fatTarget: number }[],
  dailyTarget: { protein: number; carbs: number; fats: number }
): MacroSumMismatchResult {
  const summedProtein = mealEntries.reduce((sum, m) => sum + m.proteinTarget, 0);
  const summedCarbs = mealEntries.reduce((sum, m) => sum + m.carbsTarget, 0);
  const summedFat = mealEntries.reduce((sum, m) => sum + m.fatTarget, 0);
  const isMismatched =
    Math.abs(summedProtein - dailyTarget.protein) > MACRO_SUM_TOLERANCE_G ||
    Math.abs(summedCarbs - dailyTarget.carbs) > MACRO_SUM_TOLERANCE_G ||
    Math.abs(summedFat - dailyTarget.fats) > MACRO_SUM_TOLERANCE_G;
  return {
    isMismatched,
    summedProtein,
    summedCarbs,
    summedFat,
    targetProtein: dailyTarget.protein,
    targetCarbs: dailyTarget.carbs,
    targetFat: dailyTarget.fats,
  };
}

// Check #3 — a restricted ingredient slipping into an already-assigned
// meal. generateMealOptions() already screens a coach's typed dietary-
// restrictions text against each recipe's own keyword list at
// generation time — this runs the same ban-list logic in reverse,
// against whatever was actually saved, so a plan assigned before a
// restriction was added (or edited by hand) still gets caught.
export interface RestrictedIngredientSlip {
  mealId: string;
  mealTitle: string;
  recipeName: string | null;
  matchedRestriction: string;
}

// Mirrors generateMealOptions' own exclusion in lib/meal-engine.ts — a
// diet-style label ("vegan", "keto") isn't an ingredient to ban, and
// checking for the literal word inside ingredient text would never
// usefully match anyway.
const ARCHETYPE_LABELS = ["vegan", "plant-based", "carnivore", "keto", "paleo"];

export function detectRestrictedIngredientSlips(
  mealEntries: {
    mealId: string;
    title: string;
    recipes?: { recipeName: string | null; ingredients: string[] }[];
  }[],
  dietaryRestrictionsText: string | null | undefined
): RestrictedIngredientSlip[] {
  const bans = (dietaryRestrictionsText ?? "")
    .toLowerCase()
    .split(/[,/]/)
    .map((s) => s.trim())
    .filter((s) => s.length >= 3 && !ARCHETYPE_LABELS.includes(s));
  if (bans.length === 0) return [];

  // A restriction is very often typed as a plural ("peanuts", "eggs")
  // while a recipe names the singular ingredient ("Peanut Butter",
  // "Egg Whites") — plain substring matching alone misses that real,
  // common case. Also checking the singularized stem catches it without
  // a full stemming library.
  function stem(word: string): string {
    return word.endsWith("s") && word.length > 3 ? word.slice(0, -1) : word;
  }

  const slips: RestrictedIngredientSlip[] = [];
  for (const meal of mealEntries) {
    for (const recipe of meal.recipes ?? []) {
      const text = recipe.ingredients.join(" ").replace(/<[^>]+>/g, " ").toLowerCase();
      for (const ban of bans) {
        const banStem = stem(ban);
        if (text.includes(ban) || (banStem !== ban && text.includes(banStem))) {
          slips.push({ mealId: meal.mealId, mealTitle: meal.title, recipeName: recipe.recipeName, matchedRestriction: ban });
        }
      }
    }
  }
  return slips;
}

// Check #4 — protein meaningfully under baseline, sustained rather than
// a one-off day. Compares real LOGGED protein (food_log_entries.
// protein_g, not a typed-in target) against lib/macros.ts's own
// estimateProteinFromBodyWeight — the same 1g/lb baseline
// computeCheckIn's macro split already locks to, independent of
// whatever target a coach may have set on a specific plan.
export interface ProteinTooLowResult {
  isLow: boolean;
  avgLoggedProtein: number;
  targetProtein: number;
  daysBelowTarget: number;
  daysWithData: number;
}

const PROTEIN_LOW_THRESHOLD_FRACTION = 0.8; // "meaningfully under" = >20% under baseline
const MIN_DAYS_FOR_SUSTAINED = 3; // needs at least this many logged days to judge a pattern
const SUSTAINED_FRACTION = 0.7; // "sustained" = most (not necessarily every) day in the window

export function detectProteinTooLow(
  loggedProteinByDay: number[],
  targetProtein: number
): ProteinTooLowResult {
  const daysWithData = loggedProteinByDay.length;
  if (daysWithData === 0 || targetProtein <= 0) {
    return { isLow: false, avgLoggedProtein: 0, targetProtein, daysBelowTarget: 0, daysWithData };
  }
  const threshold = targetProtein * PROTEIN_LOW_THRESHOLD_FRACTION;
  const daysBelowTarget = loggedProteinByDay.filter((p) => p < threshold).length;
  const avgLoggedProtein = Math.round(
    loggedProteinByDay.reduce((sum, p) => sum + p, 0) / daysWithData
  );
  const isLow = daysWithData >= MIN_DAYS_FOR_SUSTAINED && daysBelowTarget / daysWithData >= SUSTAINED_FRACTION;
  return { isLow, avgLoggedProtein, targetProtein, daysBelowTarget, daysWithData };
}
