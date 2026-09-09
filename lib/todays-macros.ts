// A coach can set a day's macro target two different, independent ways:
// the plain daily_macros row (the Smart Macro Fill panel on a client's
// per-day calendar page), or a full meal_plans row (the nutrition
// engine, which saves its own computed macros object alongside the
// specific meals it built to hit them). Nothing reconciles these — a day
// can show one macro number while the meals actually displayed right
// next to it were computed for a completely different number, if a
// coach used both tools for the same day.
//
// When a meal plan exists for the day, its own target is the one the
// shown meals actually match, so it wins; daily_macros is the fallback
// for a day with no full meal plan (or one whose macros are missing).

export interface DayMacroTarget {
  calories: number | null;
  proteinG: number | null;
  carbsG: number | null;
  fatG: number | null;
}

interface DailyMacrosRow {
  calories: number | null;
  protein_g: number | null;
  carbs_g: number | null;
  fat_g: number | null;
}

interface MealPlanMacroBucket {
  calories?: number | null;
  protein?: number | null;
  carbs?: number | null;
  fats?: number | null;
}

export function resolveDayMacroTarget(
  dailyMacrosRow: DailyMacrosRow | null,
  mealPlanMacros: Record<string, MealPlanMacroBucket> | null,
  mealPlanMeals: Record<string, unknown[]> | null
): DayMacroTarget | null {
  if (mealPlanMacros) {
    // meal_plans.macros and meal_plans.meals are always written together
    // from the same {daily} or {train, rest} shape (meal-plan-generator's
    // handleSave/handleAssignDays), so whichever bucket actually has
    // meals assigned for this day is the one whose macros apply to it.
    const populatedBucket = mealPlanMeals
      ? Object.keys(mealPlanMeals).find((b) => (mealPlanMeals[b] ?? []).length > 0)
      : undefined;
    const bucketKey =
      populatedBucket && mealPlanMacros[populatedBucket] ? populatedBucket : Object.keys(mealPlanMacros)[0];
    const bucket = bucketKey ? mealPlanMacros[bucketKey] : null;
    if (bucket && bucket.calories != null) {
      return {
        calories: bucket.calories ?? null,
        proteinG: bucket.protein ?? null,
        carbsG: bucket.carbs ?? null,
        fatG: bucket.fats ?? null,
      };
    }
  }

  if (dailyMacrosRow) {
    return {
      calories: dailyMacrosRow.calories,
      proteinG: dailyMacrosRow.protein_g,
      carbsG: dailyMacrosRow.carbs_g,
      fatG: dailyMacrosRow.fat_g,
    };
  }

  return null;
}
