import { checkLines, describeHit, hasSafetyHit, type AllergenHit, type FoodRules } from "@/lib/allergen-check";
import { mealRecipeChoices, type MealEntryPayload, type MealRecipeChoice } from "@/lib/meal-plan-assignment";

// A plan is only as safe as the preferences at the time it is checked. A client can add an allergy AFTER a plan was assigned, so the saved plan is checked again: when the
// coach looks at it (a banner), and when the client's Today's meals is drawn (a flagged option is HIDDEN from the client until the coach changes the plan). The same
// check runs on every meal option whatever its source: a library recipe, an AI option, a scaled plan.

type PlanMeals = Record<string, MealEntryPayload[]> | null | undefined;

export interface FlaggedChoice {
  bucket: string;
  mealId: string;
  mealTitle: string;
  choiceIndex: number;
  recipeName: string | null;
  hits: AllergenHit[];
  // At least one hit is an allergy (a safety hit); otherwise it is only a preference (an intolerance, a dislike, or a diet rule).
  safety: boolean;
}

// An ingredient line may carry markup (a library recipe's own <strong>); only the words are checked.
const plain = (s: string) => s.replace(/<[^>]+>/g, " ");

function linesOf(choice: MealRecipeChoice): string[] {
  // A library-first option also carries its structured lines: each food's name AND its printed label are checked, not only the printed text.
  const structured = (choice.lines ?? []).flatMap((l) => [l.name, ...(l.label && l.label !== l.name ? [l.label] : []), ...(l.matched && l.matched !== l.name && l.matched !== l.label ? [l.matched] : [])]);
  return [...(choice.recipeName ? [choice.recipeName] : []), ...choice.ingredients.map(plain), ...structured];
}

export function checkPlanAgainstPreferences(meals: PlanMeals, rules: FoodRules): FlaggedChoice[] {
  const out: FlaggedChoice[] = [];
  if (!meals) return out;
  for (const [bucket, entries] of Object.entries(meals)) {
    for (const meal of entries ?? []) {
      mealRecipeChoices(meal).forEach((choice, choiceIndex) => {
        const hits = checkLines(linesOf(choice), rules);
        if (hits.length > 0) {
          out.push({ bucket, mealId: meal.mealId, mealTitle: meal.title, choiceIndex, recipeName: choice.recipeName, hits, safety: hasSafetyHit(hits) });
        }
      });
    }
  }
  return out;
}

export interface ClientPlanView {
  meals: Record<string, MealEntryPayload[]> | null;
  // Options removed from what the client sees.
  hiddenCount: number;
  // Meals that now have NO option left to show: the screen says the coach will update them.
  emptiedMeals: { bucket: string; mealId: string; title: string }[];
}

// What the CLIENT is shown: every flagged option removed. A meal left with no option is kept (so the slot still shows) with no recipes, and listed in emptiedMeals.
export function filterPlanForClient(meals: PlanMeals, rules: FoodRules): ClientPlanView {
  if (!meals) return { meals: null, hiddenCount: 0, emptiedMeals: [] };
  const flagged = checkPlanAgainstPreferences(meals, rules);
  if (flagged.length === 0) return { meals: meals as Record<string, MealEntryPayload[]>, hiddenCount: 0, emptiedMeals: [] };
  const key = (bucket: string, mealId: string, i: number) => `${bucket}|${mealId}|${i}`;
  const bad = new Set(flagged.map((f) => key(f.bucket, f.mealId, f.choiceIndex)));
  const emptiedMeals: ClientPlanView["emptiedMeals"] = [];
  const result: Record<string, MealEntryPayload[]> = {};
  for (const [bucket, entries] of Object.entries(meals)) {
    result[bucket] = (entries ?? []).map((meal) => {
      const choices = mealRecipeChoices(meal);
      if (choices.length === 0) return meal;
      const keep = choices.filter((_, i) => !bad.has(key(bucket, meal.mealId, i)));
      if (keep.length === choices.length) return meal;
      if (keep.length === 0) emptiedMeals.push({ bucket, mealId: meal.mealId, title: meal.title });
      // The legacy single-recipe fields are cleared too, or the hidden option would come back through them. The featured option keeps its place if it is still shown.
      const featured = meal.featuredIndex !== undefined ? choices[meal.featuredIndex] : undefined;
      const featuredIndex = featured ? keep.indexOf(featured) : -1;
      const { featuredIndex: _dropped, ...rest } = meal;
      void _dropped;
      return { ...rest, ...(featuredIndex >= 0 ? { featuredIndex } : {}), recipes: keep, recipeId: null, recipeName: null, ingredients: [] };
    });
  }
  return { meals: result, hiddenCount: flagged.length, emptiedMeals };
}

// FAIL CLOSED. When the client's food rules could not be READ (a database error, as opposed to a client who simply has none), nothing can be checked, so nothing is shown:
// every recipe option is hidden and each meal says the coach is updating it. Showing an unchecked plan would turn a broken read into an allergen reaching a client.
export function hidePlanRecipes(meals: PlanMeals): ClientPlanView {
  if (!meals) return { meals: null, hiddenCount: 0, emptiedMeals: [] };
  let hiddenCount = 0;
  const emptiedMeals: ClientPlanView["emptiedMeals"] = [];
  const result: Record<string, MealEntryPayload[]> = {};
  for (const [bucket, entries] of Object.entries(meals)) {
    result[bucket] = (entries ?? []).map((meal) => {
      const choices = mealRecipeChoices(meal);
      if (choices.length === 0) return meal;
      hiddenCount += choices.length;
      emptiedMeals.push({ bucket, mealId: meal.mealId, title: meal.title });
      const { featuredIndex: _dropped, ...rest } = meal;
      void _dropped;
      return { ...rest, recipes: [], recipeId: null, recipeName: null, ingredients: [] };
    });
  }
  return { meals: result, hiddenCount, emptiedMeals };
}

// The older list-shaped plan (meal slots with up to three options each): the same rules, applied to each option.
export function filterGeneratedMealsForClient<T extends { options: { recipeName: string | null; ingredients: string[] }[] }>(meals: T[], rules: FoodRules | "unreadable"): T[] {
  if (rules === "unreadable") return meals.map((m) => ({ ...m, options: [] }));
  return meals.map((m) => {
    const { kept } = filterOptionsByRules(m.options, rules);
    return kept.length === m.options.length ? m : { ...m, options: kept };
  });
}

export interface FlaggedDay {
  date: string;
  flagged: FlaggedChoice[];
}

// Across the days a coach has assigned: which days now break a rule (the banner on the coach's Meal plan section).
export function flaggedDays(plans: { log_date: string; meals: unknown }[], rules: FoodRules): FlaggedDay[] {
  const out: FlaggedDay[] = [];
  for (const p of plans) {
    const flagged = checkPlanAgainstPreferences(p.meals as PlanMeals, rules);
    if (flagged.length > 0) out.push({ date: p.log_date, flagged });
  }
  return out.sort((a, b) => a.date.localeCompare(b.date));
}

// One plain line for the coach about one flagged option.
export function describeFlagged(f: FlaggedChoice): string {
  const what = f.recipeName ? `"${f.recipeName}"` : `an option for ${f.mealTitle}`;
  // The same reason found on two lines (the title and an ingredient) is one reason.
  const seen = new Set<string>();
  const reasons = f.hits.filter((h) => {
    const k = `${h.kind}|${h.label}|${h.matched}`;
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
  return `${f.mealTitle}: ${what} ${describeHit(reasons[0])}${reasons.length > 1 ? ` (and ${reasons.length - 1} more)` : ""}`;
}

// Filters meal OPTIONS (as the generator and the AI route produce them, before anything is saved) against a client's rules: an option that names an allergen, a disliked
// food or breaks the diet is never offered. Works on any option with a name and ingredient lines, whatever its source.
export function filterOptionsByRules<T extends { recipeName: string | null; ingredients: string[] }>(options: T[], rules: FoodRules): { kept: T[]; dropped: T[] } {
  const kept: T[] = [];
  const dropped: T[] = [];
  for (const option of options) {
    const lines = [...(option.recipeName ? [option.recipeName] : []), ...option.ingredients.map(plain)];
    (checkLines(lines, rules).length > 0 ? dropped : kept).push(option);
  }
  return { kept, dropped };
}

// The structured rules as plain lines for a prompt ("Allergies (never include): peanut, shellfish."). Empty when there are none.
export function rulesForPrompt(rules: FoodRules): string {
  const lines: string[] = [];
  // A typed item ("other: kiwi", a dislike) is free text. Only letters, digits, spaces and hyphens reach the model, so a typed instruction cannot steer it.
  const clean = (x: string) => x.replace(/[^A-Za-z0-9 -]+/g, " ").replace(/\s+/g, " ").trim().slice(0, 60);
  const names = (xs: string[] | undefined) =>
    (xs ?? [])
      .map((x) => clean(x.toLowerCase().startsWith("other: ") ? x.slice(7) : x))
      .filter(Boolean)
      .join(", ");
  if ((rules.allergies ?? []).length > 0) lines.push(`Allergies (a hard rule, never include any trace of these): ${names(rules.allergies)}`);
  if ((rules.intolerances ?? []).length > 0) lines.push(`Intolerances (avoid): ${names(rules.intolerances)}`);
  if ((rules.dislikes ?? []).length > 0) lines.push(`Foods they dislike (avoid): ${names(rules.dislikes)}`);
  if (rules.dietType && rules.dietType !== "omnivore") lines.push(`Diet type: ${rules.dietType}`);
  return lines.join("\n");
}
