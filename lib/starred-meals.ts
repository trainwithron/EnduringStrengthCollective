import { mealRecipeChoices, mergeMealIntoPlan, type MealEntryPayload, type MealPlanBucket, type MealPlanRow, type MealRecipeChoice } from "@/lib/meal-plan-assignment";
import { checkPlanAgainstPreferences, describeFlagged } from "@/lib/plan-preference-check";
import type { FoodRules } from "@/lib/allergen-check";
import type { LibraryRecipe } from "@/lib/library-scaling";
import { scaleStarForMeal } from "@/lib/star-to-plan";
import { choiceFromOption, libraryDietFor, optionFromScaled } from "@/lib/library-meal-plan";
import { ENABLED_TEMPLATES } from "@/lib/meal-templates";
import { allergyKeysOf } from "@/lib/allergen-check";
import { checkTolerance } from "@/lib/meal-templates/tolerance";

// A whole-portion star cannot be re-split into carbs and fat, so it never goes into a low-carb plan (Assistant review, Nov 21).
const NO_PORTION_DIETS = new Set(["keto", "carnivore", "paleo"]);

// Starred meals (Ron, Nov 19: the coach's Nutrition page revamp; database step 207). A coach stars any meal they see: a meal plan option, a meal from before a client's plan change,
// a meal a client logged. The Favorite meals tab lists them with calories and protein and "Add to plan". A starred meal is a row of the coach's favorites (recipe_favorites,
// kind 'meal'): its name, its macros as they were when it was starred, and the meal itself as a plan stores it, so adding it to a plan puts back exactly what was starred. Private
// to the coach. Pure: no database, no network.

export const MAX_STARRED_MEALS = 200;
// Sent on window when a star changes, so every star on the page (and the Favorite meals list) shows the same thing.
export const STARRED_MEALS_CHANGED = "starred-meals-changed";

export interface StarredMeal {
  key: string;
  name: string;
  calories: number | null;
  proteinG: number | null;
  carbsG: number | null;
  fatG: number | null;
  meal: MealRecipeChoice;
}

// The same meal named a little differently ("Steak and rice", " steak  and Rice ") is one star.
export function starredMealKey(name: string): string {
  return `meal:${name.trim().toLowerCase().replace(/\s+/g, " ")}`;
}

const cleanName = (name: string | null | undefined) => (name ?? "").replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim().slice(0, 200);
const num = (v: unknown): number | null => (v == null || v === "" || !Number.isFinite(Number(v)) ? null : Number(v));

// A meal plan option (from the planner, a saved plan or a plan from before a change).
export function starFromChoice(choice: MealRecipeChoice): StarredMeal | null {
  const name = cleanName(choice.recipeName);
  if (!name) return null;
  const m = choice.macros;
  return {
    key: starredMealKey(name),
    name,
    calories: m ? Math.round(m.calories) : null,
    proteinG: m ? Math.round(m.proteinG) : null,
    carbsG: m ? Math.round(m.carbsG) : null,
    fatG: m ? Math.round(m.fatG) : null,
    meal: { ...choice, recipeName: name },
  };
}

// A meal a client logged: its name and the macros they logged (whatever they logged; nothing is made up). It has no ingredient amounts.
export function starFromLogged(item: { description: string | null; calories: number | null; proteinG?: number | null; carbsG?: number | null; fatG?: number | null }): StarredMeal | null {
  const name = cleanName(item.description);
  if (!name) return null;
  const calories = num(item.calories);
  const proteinG = num(item.proteinG);
  const carbsG = num(item.carbsG);
  const fatG = num(item.fatG);
  const all = calories != null && proteinG != null && carbsG != null && fatG != null;
  return {
    key: starredMealKey(name),
    name,
    calories: calories == null ? null : Math.round(calories),
    proteinG: proteinG == null ? null : Math.round(proteinG),
    carbsG: carbsG == null ? null : Math.round(carbsG),
    fatG: fatG == null ? null : Math.round(fatG),
    meal: { recipeId: null, recipeName: name, ingredients: [], ...(all ? { macros: { calories: Math.round(calories), proteinG: Math.round(proteinG), carbsG: Math.round(carbsG), fatG: Math.round(fatG) } } : {}) },
  };
}

export interface StarredRow {
  recipe_id: string;
  label: string | null;
  calories: number | string | null;
  protein_g: number | string | null;
  carbs_g: number | string | null;
  fat_g: number | string | null;
  meal: unknown;
}

export function rowToStarredMeal(r: StarredRow): StarredMeal | null {
  const name = cleanName(r.label);
  if (!name || !r.meal || typeof r.meal !== "object" || Array.isArray(r.meal)) return null;
  const meal = r.meal as MealRecipeChoice;
  return {
    key: r.recipe_id,
    name,
    calories: num(r.calories),
    proteinG: num(r.protein_g),
    carbsG: num(r.carbs_g),
    fatG: num(r.fat_g),
    meal: { ...meal, recipeName: meal.recipeName || name, ingredients: Array.isArray(meal.ingredients) ? meal.ingredients : [] },
  };
}

export function starInsertRow(profileId: string, s: StarredMeal) {
  return { profile_id: profileId, recipe_id: s.key, kind: "meal", label: s.name, calories: s.calories, protein_g: s.proteinG, carbs_g: s.carbsG, fat_g: s.fatG, meal: s.meal };
}

// "540 kcal · 42 g protein": calories and protein lead; a number that is not known reads as a dash, never as zero.
export function caloriesProteinLine(s: { calories: number | null; proteinG: number | null }): string {
  const kcal = s.calories == null ? "– kcal" : `${Math.round(s.calories).toLocaleString("en-US")} kcal`;
  const protein = s.proteinG == null ? "– g protein" : `${Math.round(s.proteinG)} g protein`;
  return `${kcal} · ${protein}`;
}

// ---- Add to plan: a starred meal goes in as one more option of a meal already in the client's plan that day ----

export interface PlanMealChoiceTarget {
  bucket: MealPlanBucket;
  mealId: string;
  label: string;
}

const BUCKET_LABEL: Record<MealPlanBucket, string> = { daily: "", train: "Training day: ", rest: "Rest day: " };

// The meals of a saved day, in order (a carb-cycling day lists its training-day meals, then its rest-day meals).
export function mealsOfPlan(meals: Record<string, MealEntryPayload[]> | null | undefined): PlanMealChoiceTarget[] {
  if (!meals || typeof meals !== "object" || Array.isArray(meals)) return [];
  const out: PlanMealChoiceTarget[] = [];
  for (const bucket of ["daily", "train", "rest"] as MealPlanBucket[]) {
    for (const entry of Array.isArray(meals[bucket]) ? meals[bucket] : []) out.push({ bucket, mealId: entry.mealId, label: `${BUCKET_LABEL[bucket]}${entry.title}` });
  }
  return out;
}

export type AddToMealResult = { ok: true; row: MealPlanRow } | { ok: false; reason: string };

// The starred meal, scaled to the chosen meal's own target (Ron, Nov 21: the builder's scaling, ingredient by ingredient, or a whole portion when it has no amounts), checked against
// the client's food rules, added as one more option of that meal. The day is marked as changed by hand (so "Build the week" asks before replacing it), and every other meal of the
// day is left exactly as it is. coachRecipe: the coach's own recipe a "r:" star stands for, read by the caller.
export function addStarredToPlan(args: { plan: MealPlanRow; bucket: MealPlanBucket; mealId: string; star: StarredMeal; rules: FoodRules; clientFirst: string; coachRecipe?: LibraryRecipe | null }): AddToMealResult {
  const entry = (args.plan.meals?.[args.bucket] ?? []).find((m) => m.mealId === args.mealId);
  if (!entry) return { ok: false, reason: "That meal isn't in the plan for that day any more. Pick the day again." };
  const choices = mealRecipeChoices(entry);
  if (choices.some((c) => starredMealKey(c.recipeName ?? "") === args.star.key)) return { ok: false, reason: `${args.star.name} is already an option for ${entry.title} that day.` };
  const hasTarget = [entry.proteinTarget, entry.carbsTarget, entry.fatTarget].every((n) => typeof n === "number" && Number.isFinite(n)) && (entry.proteinTarget ?? 0) + (entry.carbsTarget ?? 0) + (entry.fatTarget ?? 0) > 0;
  const target = hasTarget ? { proteinG: entry.proteinTarget as number, carbsG: entry.carbsTarget as number, fatG: entry.fatTarget as number } : null;
  const scaled = target ? scaleStarForMeal(args.star, target, args.coachRecipe) : null;
  // A whole portion (no amounts to scale): never in a low-carb plan, and never with more carbs than the meal allows.
  if (!scaled || scaled.portion != null) {
    const diet = [args.rules.dietType, args.plan.archetype].find((d): d is string => !!d && NO_PORTION_DIETS.has(d));
    if (diet) return { ok: false, reason: `Not added: ${args.star.name} is a whole meal with no amounts to adjust, so it can't go into ${args.clientFirst}'s ${diet} plan.` };
    if (scaled && target && checkTolerance(scaled.macros, target).misses.includes("carbs")) return { ok: false, reason: `Not added: ${args.star.name} has more carbs than ${entry.title} allows for ${args.clientFirst}.` };
  }
  const recipe = args.coachRecipe && args.star.meal.key === `r:${args.coachRecipe.id}` ? args.coachRecipe : null;
  // A star scaled from its template or recipe keeps that meal's diets: an omnivore "chicken and rice" never goes into a paleo or carnivore plan (the builder filters the same way).
  if (scaled && scaled.portion == null) {
    const diet = libraryDietFor(args.rules.dietType, args.plan.archetype);
    const key = args.star.meal.key ?? "";
    const diets = key.startsWith("t:") ? ENABLED_TEMPLATES.find((r) => `t:${r.id}` === key)?.archetypes : key.startsWith("r:") ? recipe?.diets : undefined;
    if (diets && !(diets as string[]).includes(diet)) return { ok: false, reason: `Not added: ${args.star.name} isn't made for a ${diet} diet, so it can't go into ${args.clientFirst}'s ${diet} plan.` };
  }
  // A coach recipe tagged with one of the client's allergies when it was saved is never added (the builder's second net).
  const allergyKeys = allergyKeysOf(args.rules.allergies) as Set<string>;
  const taggedHit = (recipe?.allergens ?? []).find((t) => allergyKeys.has(t));
  if (taggedHit) return { ok: false, reason: `Not added: ${args.star.name} is marked as containing ${taggedHit}, against ${args.clientFirst}'s food preferences.` };
  const choice: MealRecipeChoice = scaled ? { ...choiceFromOption(optionFromScaled(scaled)), fromFavorite: true } : { ...args.star.meal, fromFavorite: true };
  // The rules on what is added AND on the meal as it was starred: a hit on either refuses it.
  const flagged = checkPlanAgainstPreferences({ [args.bucket]: [{ ...entry, recipes: [choice, args.star.meal] }] }, args.rules);
  if (flagged.length > 0) return { ok: false, reason: `Not added: ${describeFlagged(flagged[0])}, against ${args.clientFirst}'s food preferences.` };
  const updated: MealEntryPayload = { ...entry, recipes: [...choices, choice] };
  delete updated.recipeId;
  delete updated.recipeName;
  delete updated.ingredients;
  const row = mergeMealIntoPlan(args.plan, args.bucket, updated, { archetype: args.plan.archetype, mealCount: args.plan.meal_count, includeSnack: args.plan.include_snack, carbCycling: args.plan.carb_cycling, macros: args.plan.macros });
  return { ok: true, row };
}

// The distinct meals of a plan from before a change (a try's saved days), for starring: each option once, by name, in the order they appear.
export function choicesOfSnapshots(snapshots: unknown, max = 12): MealRecipeChoice[] {
  const out: MealRecipeChoice[] = [];
  const seen = new Set<string>();
  for (const snap of Array.isArray(snapshots) ? snapshots : []) {
    const meals = (snap as { meals?: unknown } | null)?.meals;
    if (!meals || typeof meals !== "object" || Array.isArray(meals)) continue;
    for (const entries of Object.values(meals as Record<string, MealEntryPayload[]>)) {
      for (const entry of Array.isArray(entries) ? entries : []) {
        for (const choice of mealRecipeChoices(entry)) {
          const name = cleanName(choice.recipeName);
          if (!name || seen.has(starredMealKey(name))) continue;
          seen.add(starredMealKey(name));
          out.push(choice);
          if (out.length >= max) return out;
        }
      }
    }
  }
  return out;
}

// Nutrition's Favorite meals tab shows once the coach has starred a meal (Ron, Nov 21); a count that could not be read keeps it, so nothing the coach has goes missing.
export function showFavoritesTab(count: number | null | undefined, readFailed: boolean): boolean {
  return readFailed || (count ?? 0) > 0;
}
