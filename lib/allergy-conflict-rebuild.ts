import type { FoodRules } from "@/lib/allergen-check";
import { checkPlanAgainstPreferences } from "@/lib/plan-preference-check";
import { choiceKey, mealRecipeChoices, type MealEntryPayload, type MealRecipeChoice } from "@/lib/meal-plan-assignment";
import type { Slot } from "@/lib/meal-templates/types";

// Ron, Oct 21: "if I have assigned them a meal plan ... and it has something they're allergic to and they go through and put their allergies in, AI should automatically catch that and
// regenerate". When a client saves their allergies or foods they avoid, the days of their assigned plan from today on are checked again, and ONLY the options that now break a rule are
// swapped: everything else on the day (the other options, the meals, the macros, who built it and how the day is counted for the client's own "different plan" tries) stays exactly as it
// was. A replacement comes from the coach's recipe library first (lib/library-selection.ts, which applies the same rules), and only a meal left with NO option is offered to the AI (the
// route does that, charged to the coach's AI budget). A meal nothing safe can fill stays hidden from the client (filterPlanForClient already hides a flagged option) and the coach is asked.
// Pure: no database, no AI.

export type PlanMeals = Record<string, MealEntryPayload[]>;

export interface ConflictPlanRow {
  log_date: string;
  group_id: string;
  archetype: string;
  meals: PlanMeals | null;
}

export interface EmptyMeal {
  log_date: string;
  archetype: string;
  bucket: string;
  mealId: string;
  slot: Slot;
  target: { proteinG: number; carbsG: number; fatG: number };
}

export interface SwapPlan {
  /** Each changed day with its new meals (only days that had a flagged option). */
  days: { log_date: string; group_id: string; meals: PlanMeals }[];
  /** Meals left with no option at all: the AI may fill these; otherwise they stay hidden and the coach is asked. */
  emptyMeals: EmptyMeal[];
  /** Options taken out, and how many of them were replaced from the library. */
  removed: number;
  replaced: number;
  /** The allergies the removed options broke (for the coach's notice), and whether foods they avoid were among the reasons. */
  allergyLabels: string[];
  avoidedFoods: boolean;
}

/** The library slot of a saved meal, from its id or title (the planner's titles: "Meal 1: Breakfast", "Meal 4: Dinner & Recovery", "Snack: Between-Meal Fuel"). */
export function slotOfMeal(meal: Pick<MealEntryPayload, "mealId" | "title">): Slot {
  const t = `${meal.mealId} ${meal.title}`.toLowerCase();
  if (/snack/.test(t)) return "snack";
  if (/breakfast|fast-breaking/.test(t)) return "breakfast";
  if (/dinner/.test(t)) return "dinner";
  return "lunch";
}

/** Library options for one meal: (slot, the meal's target, keys already on the day, how many). Already filtered by the client's rules. */
export type LibraryPick = (slot: Slot, target: EmptyMeal["target"], excludeKeys: Set<string>, count: number, archetype: string) => MealRecipeChoice[];

export function planAllergySwaps(rows: ConflictPlanRow[], rules: FoodRules, todayKey: string, pick: LibraryPick): SwapPlan {
  const out: SwapPlan = { days: [], emptyMeals: [], removed: 0, replaced: 0, allergyLabels: [], avoidedFoods: false };
  for (const row of [...rows].sort((a, b) => a.log_date.localeCompare(b.log_date))) {
    if (row.log_date < todayKey || !row.meals) continue;
    const flagged = checkPlanAgainstPreferences(row.meals, rules);
    if (flagged.length === 0) continue;
    const bad = new Set(flagged.map((f) => `${f.bucket}|${f.mealId}|${f.choiceIndex}`));
    for (const f of flagged) for (const h of f.hits) {
      if (h.kind === "allergy") {
        const label = h.label.toLowerCase().replace(/^other: /, "");
        if (!out.allergyLabels.includes(label)) out.allergyLabels.push(label);
      } else out.avoidedFoods = true;
    }
    // Every option already on the day, so a replacement never repeats one.
    const dayKeys = new Set<string>();
    for (const entries of Object.values(row.meals)) for (const m of entries ?? []) for (const c of mealRecipeChoices(m)) {
      const k = choiceKey(c);
      if (k) dayKeys.add(k);
    }
    const meals: PlanMeals = {};
    for (const [bucket, entries] of Object.entries(row.meals)) {
      meals[bucket] = (entries ?? []).map((meal) => {
        const choices = mealRecipeChoices(meal);
        const keep = choices.filter((_, i) => !bad.has(`${bucket}|${meal.mealId}|${i}`));
        if (keep.length === choices.length) return meal;
        const dropped = choices.length - keep.length;
        out.removed += dropped;
        const target = { proteinG: meal.proteinTarget, carbsG: meal.carbsTarget, fatG: meal.fatTarget };
        const slot = slotOfMeal(meal);
        const fresh = pick(slot, target, dayKeys, dropped, row.archetype);
        for (const c of fresh) {
          const k = choiceKey(c);
          if (k) dayKeys.add(k);
        }
        out.replaced += fresh.length;
        const recipes = [...keep, ...fresh];
        if (recipes.length === 0) out.emptyMeals.push({ log_date: row.log_date, archetype: row.archetype, bucket, mealId: meal.mealId, slot, target });
        // The featured option keeps its place when it stays; otherwise the first kept option leads. The legacy single-recipe fields are cleared (a removed option would come back through them).
        const featured = meal.featuredIndex !== undefined ? choices[meal.featuredIndex] : undefined;
        const featuredIndex = featured ? recipes.indexOf(featured) : -1;
        const { featuredIndex: _f, ...rest } = meal;
        void _f;
        return { ...rest, ...(featuredIndex > 0 ? { featuredIndex } : {}), recipes, recipeId: null, recipeName: null, ingredients: [] };
      });
    }
    out.days.push({ log_date: row.log_date, group_id: row.group_id, meals });
  }
  return out;
}

/** Puts AI options into the meals that were left empty (only those), in place. */
export function fillEmptyMeals(plan: SwapPlan, filled: Map<string, MealRecipeChoice[]>): void {
  for (const day of plan.days) {
    for (const [bucket, entries] of Object.entries(day.meals)) {
      day.meals[bucket] = entries.map((m) => {
        const add = filled.get(`${day.log_date}|${bucket}|${m.mealId}`);
        return add && add.length > 0 && mealRecipeChoices(m).length === 0 ? { ...m, recipes: add } : m;
      });
    }
  }
}

export const emptyMealKey = (e: Pick<EmptyMeal, "log_date" | "bucket" | "mealId">) => `${e.log_date}|${e.bucket}|${e.mealId}`;

/**
 * The last check before anything is written: every option that will be saved is checked against the rules again, whatever its source. A day that still breaks a rule is NOT written
 * (fail closed: the client keeps seeing it filtered, and the coach is asked).
 */
export function safeDays(plan: SwapPlan, rules: FoodRules): { safe: SwapPlan["days"]; unsafe: string[] } {
  const safe = plan.days.filter((d) => checkPlanAgainstPreferences(d.meals, rules).length === 0);
  return { safe, unsafe: plan.days.filter((d) => !safe.includes(d)).map((d) => d.log_date) };
}

/** The meals still empty/** Meals with no option left on the given days (after a rebuild, or on the coach's plan from today on): the coach is asked about these. */
export function emptyMealsOf(days: { log_date: string; meals: unknown }[]): { log_date: string; title: string }[] {
  const out: { log_date: string; title: string }[] = [];
  for (const d of days) {
    const meals = d.meals && typeof d.meals === "object" ? (d.meals as PlanMeals) : {};
    for (const entries of Object.values(meals)) for (const m of Array.isArray(entries) ? entries : []) if (mealRecipeChoices(m).length === 0) out.push({ log_date: d.log_date, title: m.title });
  }
  return out.sort((a, b) => a.log_date.localeCompare(b.log_date));
}

export const stillEmpty = (plan: SwapPlan) => emptyMealsOf(plan.days);

/** The coach's notice, fixed wording: "Johann's peanut allergy clashed with their meal plan: 3 days rebuilt automatically." (plus "1 meal needs you." when one could not be filled). */
export function rebuildNotice(name: string, plan: Pick<SwapPlan, "allergyLabels" | "avoidedFoods">, daysChanged: number, mealsNeedingCoach: number): string {
  const labels = plan.allergyLabels;
  const what =
    labels.length === 0
      ? `${name}'s foods to avoid clashed with their meal plan`
      : `${name}'s ${labels.length === 1 ? labels[0] : `${labels.slice(0, -1).join(", ")} and ${labels[labels.length - 1]}`} ${labels.length === 1 ? "allergy" : "allergies"} clashed with their meal plan`;
  const days = daysChanged === 1 ? "1 day rebuilt automatically" : `${daysChanged} days rebuilt automatically`;
  const need = mealsNeedingCoach > 0 ? ` ${mealsNeedingCoach === 1 ? "1 meal needs" : `${mealsNeedingCoach} meals need`} you.` : "";
  return `${what}: ${days}.${need}`.slice(0, 300);
}
