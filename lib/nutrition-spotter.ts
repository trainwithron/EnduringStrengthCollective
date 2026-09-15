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
