// Lets a coach assign one specific meal-slot recipe to a subset of
// weekdays (e.g. chicken & rice on Tue/Thu/Sat, beef & sweet potato on
// Mon/Wed/Fri) instead of only ever saving one full generated day at a
// time. Pure date math + JSON-merge logic, kept independent of Supabase
// so it's directly testable.

export interface MealRecipeChoice {
  recipeId: string | null;
  recipeName: string | null;
  ingredients: string[];
}

export interface MealEntryPayload {
  mealId: string;
  title: string;
  proteinTarget: number;
  carbsTarget: number;
  fatTarget: number;
  // One meal slot (e.g. "Breakfast") can now hold several recipe choices
  // at once — a client picks whichever one they actually make that day,
  // instead of the coach being forced to pick exactly one option per
  // slot. `recipeId`/`recipeName`/`ingredients` stay as optional legacy
  // fields so a plan saved before this existed still reads correctly
  // (treated as a single-item `recipes` list) without needing a data
  // migration.
  recipes?: MealRecipeChoice[];
  recipeId?: string | null;
  recipeName?: string | null;
  ingredients?: string[];
}

// Normalizes either shape (new `recipes` array, or the old singular
// recipeId/recipeName/ingredients fields) into one list — the one place
// every reader should go through instead of re-deriving this fallback.
export function mealRecipeChoices(entry: MealEntryPayload): MealRecipeChoice[] {
  if (entry.recipes && entry.recipes.length > 0) return entry.recipes;
  if (entry.recipeName || entry.recipeId) {
    return [
      {
        recipeId: entry.recipeId ?? null,
        recipeName: entry.recipeName ?? null,
        ingredients: entry.ingredients ?? [],
      },
    ];
  }
  return [];
}

export type MealPlanBucket = "daily" | "train" | "rest";

export interface MealPlanRow {
  archetype: string;
  meal_count: number;
  include_snack: boolean;
  carb_cycling: boolean;
  rationale: string | null;
  macros: Record<string, unknown>;
  meals: Record<string, MealEntryPayload[]>;
}

function toDateKey(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(
    d.getDate()
  ).padStart(2, "0")}`;
}

// The Sun..Sat week (matches this app's existing weekday convention,
// e.g. habit scheduling) containing the given anchor date.
export function getWeekDates(anchorDateStr: string): string[] {
  const anchor = new Date(`${anchorDateStr}T00:00:00`);
  const sunday = new Date(anchor);
  sunday.setDate(anchor.getDate() - anchor.getDay());
  const dates: string[] = [];
  for (let i = 0; i < 7; i++) {
    const d = new Date(sunday);
    d.setDate(sunday.getDate() + i);
    dates.push(toDateKey(d));
  }
  return dates;
}

// Real calendar dates (within the week containing `anchorDateStr`) for
// each requested weekday number (0=Sun..6=Sat), in the same order given.
export function getDatesForWeekdays(anchorDateStr: string, weekdays: number[]): string[] {
  const week = getWeekDates(anchorDateStr);
  return weekdays.map((wd) => week[wd]);
}

// Merges one meal-slot entry into an existing (or brand-new) day's meal
// plan row. Only the targeted bucket/mealId is touched — every other
// meal slot already saved for that day, and every other bucket (e.g. a
// carb-cycling day's other train/rest half), is left exactly as-is.
export function mergeMealIntoPlan(
  existing: MealPlanRow | null,
  bucket: MealPlanBucket,
  entry: MealEntryPayload,
  fallback: {
    archetype: string;
    mealCount: number;
    includeSnack: boolean;
    carbCycling: boolean;
    macros: Record<string, unknown>;
  }
): MealPlanRow {
  const base: MealPlanRow = existing ?? {
    archetype: fallback.archetype,
    meal_count: fallback.mealCount,
    include_snack: fallback.includeSnack,
    carb_cycling: fallback.carbCycling,
    rationale: "Meal assigned individually from the weekly picker — no full check-in run for this day.",
    macros: fallback.macros,
    meals: {},
  };
  const bucketMeals = base.meals[bucket] ? [...base.meals[bucket]] : [];
  const idx = bucketMeals.findIndex((m) => m.mealId === entry.mealId);
  if (idx >= 0) bucketMeals[idx] = entry;
  else bucketMeals.push(entry);
  return { ...base, meals: { ...base.meals, [bucket]: bucketMeals } };
}
