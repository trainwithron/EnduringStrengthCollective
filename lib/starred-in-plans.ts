// The coach's starred meals in every new meal plan (Ron, Nov 21, approved: "yes build it that way"). Pure: no database.
//   1. Stars first: a starred meal is worked into a plan ahead of the library, for the meals it fits (library-selection.ts ranks it first, at most MAX_STARS_PER_SLOT of a meal's
//      three options, and the client's food rules are checked on it exactly as on every other option).
//   2. Each star is scaled to THIS client's meal target with the builder's own scaling: a starter-library meal ("t:<id>") through its template, a coach recipe ("r:<id>") through the
//      recipe scaler, so 6 oz of chicken becomes 8 oz for a bigger client. No new formula.
//   3. A star with no ingredient amounts the builder can scale (a meal a client logged, an AI option) is scaled as a whole portion, in quarters ("1¼ servings"), and says so. No
//      ingredient is ever made up.
import { caloriesOf, type Macros } from "@/lib/meal-templates/macros";
import { CALORIE_TOLERANCE, PROTEIN_TOLERANCE, type SlotTarget } from "@/lib/meal-templates/tolerance";
import type { Slot } from "@/lib/meal-templates/types";
import type { ScaledMeal, ScaledLine } from "@/lib/scaled-meal";
import type { StarredMeal } from "@/lib/starred-meals";

// At most this many of a meal's three options are stars, so a coach with many stars still gets a changing menu.
export const MAX_STARS_PER_SLOT = 2;
// How much a star is moved up in the ranking (a client's own favorite is moved up by 100): ahead of everything else, while the usual "offered lately" move-down still rotates
// several stars.
export const STAR_RANK_BONUS = 150;
export const MIN_PORTION = 0.5;
export const MAX_PORTION = 3;

/** The builder meal a star stands for: "t:<template id>" or "r:<recipe id>", or null (a logged meal, an AI option, an older star). */
export function starBuilderKey(star: Pick<StarredMeal, "meal">): string | null {
  const k = star.meal.key;
  return typeof k === "string" && /^(t|r):./.test(k) ? k : null;
}

/** The keys of every builder meal the coach starred. */
export function starredBuilderKeys(stars: StarredMeal[] | undefined): Set<string> {
  const out = new Set<string>();
  for (const s of stars ?? []) {
    const k = starBuilderKey(s);
    if (k) out.add(k);
  }
  return out;
}

const plain = (s: string) => s.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();

// The meals a whole-portion star fits, from its name (it carries no meal of its own): breakfast foods at breakfast, snack foods as a snack, anything else at lunch and dinner.
const BREAKFAST = /\b(oat|oats|oatmeal|porridge|egg|eggs|omelet|omelette|pancake|pancakes|waffle|waffles|cereal|granola|toast|bagel|yogurt|yoghurt|smoothie|breakfast|muesli|french toast)\b/i;
const SNACK = /\b(bar|bars|shake|snack|apple|banana|nuts|almonds|jerky|trail mix|rice cake|rice cakes|cottage cheese|protein pudding|string cheese)\b/i;
export function portionStarSlots(name: string): Slot[] {
  if (BREAKFAST.test(name)) return ["breakfast"];
  if (SNACK.test(name)) return ["snack"];
  return ["lunch", "dinner"];
}

/** The nearest quarter portion that brings the star's calories to the target's, between half and three portions. */
export function portionFactor(starCalories: number, targetCalories: number): number {
  if (!(starCalories > 0) || !(targetCalories > 0)) return 1;
  const raw = targetCalories / starCalories;
  return Math.min(MAX_PORTION, Math.max(MIN_PORTION, Math.round(raw * 4) / 4));
}

const FRACTION: Record<number, string> = { 0.25: "¼", 0.5: "½", 0.75: "¾" };
/** "1 serving", "1¼ servings", "½ serving", "2½ servings". */
export function portionLabel(factor: number): string {
  const whole = Math.floor(factor);
  const part = FRACTION[Math.round((factor - whole) * 100) / 100] ?? "";
  const amount = whole === 0 ? part || "0" : `${whole}${part}`;
  return `${amount} ${factor > 1 ? "servings" : "serving"}`;
}

export function scaleMacros(m: Macros, factor: number): Macros {
  const proteinG = m.proteinG * factor;
  const carbsG = m.carbsG * factor;
  const fatG = m.fatG * factor;
  return { proteinG, carbsG, fatG, calories: caloriesOf(proteinG, carbsG, fatG) };
}

/** A whole portion lands on a meal when its calories and protein are within the builder's own tolerances (a fixed meal cannot also be re-split into carbs and fat). */
export function portionLands(actual: Macros, target: SlotTarget): boolean {
  const targetCal = caloriesOf(target.proteinG, target.carbsG, target.fatG);
  return Math.abs(actual.calories - targetCal) <= CALORIE_TOLERANCE * targetCal && Math.abs(actual.proteinG - target.proteinG) <= PROTEIN_TOLERANCE * Math.max(target.proteinG, 1);
}

function starMacros(star: StarredMeal): Macros | null {
  const m = star.meal.macros;
  if (m && [m.proteinG, m.carbsG, m.fatG].every((x) => Number.isFinite(x))) return { proteinG: m.proteinG, carbsG: m.carbsG, fatG: m.fatG, calories: caloriesOf(m.proteinG, m.carbsG, m.fatG) };
  if ([star.proteinG, star.carbsG, star.fatG].every((x) => x != null && Number.isFinite(x))) {
    const p = star.proteinG as number;
    const c = star.carbsG as number;
    const f = star.fatG as number;
    return { proteinG: p, carbsG: c, fatG: f, calories: caloriesOf(p, c, f) };
  }
  return null;
}

/**
 * A star the builder cannot scale ingredient by ingredient, as a whole portion for this meal: its macros times the portion, its own ingredients as they were starred (never new
 * ones), headed by the portion ("1¼ servings"). Null when it has no macros, does not fit this meal, or no quarter portion lands on the target. `force` (Add to plan, where the coach
 * picked the meal) skips the slot and landing checks.
 */
export function portionStarMeal(star: StarredMeal, slot: Slot, target: SlotTarget, opts: { force?: boolean } = {}): ScaledMeal | null {
  const base = starMacros(star);
  if (!base || !(base.calories > 0)) return null;
  if (!opts.force && !portionStarSlots(star.name).includes(slot)) return null;
  const factor = portionFactor(base.calories, caloriesOf(target.proteinG, target.carbsG, target.fatG));
  const macros = scaleMacros(base, factor);
  if (!opts.force && !portionLands(macros, target)) return null;
  const starredLines: ScaledLine[] = Array.isArray(star.meal.lines) ? star.meal.lines : [];
  const lines: ScaledLine[] = starredLines.length > 0 ? starredLines : (star.meal.ingredients ?? []).map((t) => ({ name: plain(t), label: plain(t), grams: null }));
  return {
    key: `fav:${star.key}`,
    source: star.meal.source === "ai" ? "ai" : "coach",
    recipeId: star.meal.recipeId ?? star.key,
    name: star.name,
    slot,
    lines,
    // plain words (an AI option's lines are shown as plain text)
    displayLines: [`${portionLabel(factor)} of the starred meal, as it was starred`, ...(star.meal.ingredients ?? [])],
    prepText: "",
    macros,
    mainProtein: star.meal.mainProtein ?? null,
    drift: 0,
    coachStar: true,
    portion: factor,
  };
}
