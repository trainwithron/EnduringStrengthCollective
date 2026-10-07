// Library-first selection: for one meal slot and one target, the options to offer a client, chosen from the starter library (Ron's recipes) and the coach's own saved recipes.
//   1. every candidate is scaled to the target; one that cannot land inside the tolerance for THIS target is skipped, never shown;
//   2. the client's food rules (allergies, intolerances, dislikes, diet) are checked AGAIN on what the meal really contains (the meal's name, every food's name and printed label,
//      and the preparation text), so a wrong tag can never get a meal through;
//   3. favorites first, then foods the client likes, then closeness to the target; when the coach asks to "mix it up", meals offered recently are moved down (never a favorite);
//   4. up to three, preferring different main proteins.
// Fewer than three left is reported as a shortfall, so the screen says "2 from the library, 1 to generate" instead of quietly showing two.
import { allergyKeysOf, checkLines, type FoodRules } from "@/lib/allergen-check";
import { normalizeName } from "@/lib/library-favorites";
import { scaleLibraryRecipe, type LibraryRecipe } from "@/lib/library-scaling";
import { templatesFor } from "@/lib/meal-templates";
import { scaleTemplate } from "@/lib/meal-templates/scale";
import { missScore, type SlotTarget } from "@/lib/meal-templates/tolerance";
import type { DietType, Slot } from "@/lib/meal-templates/types";
import { checkTextOf, fromTemplateMeal, type ScaledMeal } from "@/lib/scaled-meal";

export const OPTIONS_PER_SLOT = 3;
export const DEFAULT_RECENT_DAYS = 7;

export interface SelectionContext {
  rules: FoodRules;
  diet: DietType;
  // Foods the client likes (from their preferences): a meal that contains one is ranked higher.
  likes: string[];
  favorites: { ids: Set<string>; names: Set<string> };
  // For each meal key, how many days ago it was last offered to this client. Used only when mixItUp is on.
  recentlyOffered: Map<string, number>;
  mixItUp: boolean;
  recentDays: number;
  // The coach's own saved recipes (already read from the database).
  coachRecipes: LibraryRecipe[];
  // Meals already used elsewhere in this build (so one day does not offer the same meal twice).
  excludeKeys?: Set<string>;
}

export interface SlotSelection {
  options: ScaledMeal[];
  // How many of the three are missing: the screen offers to generate that many.
  shortfall: number;
  // How many meals landed on the target before the client's rules were applied, and how many the rules removed.
  landed: number;
  leftOutForRules: number;
}

// How much a client wants the menu to change (their preference): "mix it up" moves anything offered in the last week down, "a few favorites on repeat" only what was offered in
// the last three days, and "same meals most days" never moves anything and keeps the same featured meal.
export type VarietyChoice = "mix_it_up" | "few_favorites" | "same_most_days";
export function varietySettings(variety: string | null | undefined): { mixItUp: boolean; recentDays: number; rotateFeatured: boolean } {
  if (variety === "same_most_days") return { mixItUp: false, recentDays: DEFAULT_RECENT_DAYS, rotateFeatured: false };
  if (variety === "mix_it_up") return { mixItUp: true, recentDays: DEFAULT_RECENT_DAYS, rotateFeatured: true };
  return { mixItUp: true, recentDays: 3, rotateFeatured: true };
}

export const isFavorite = (meal: Pick<ScaledMeal, "recipeId" | "name">, fav: SelectionContext["favorites"]): boolean =>
  fav.ids.has(meal.recipeId) || fav.names.has(normalizeName(meal.name));

function likeHits(meal: ScaledMeal, likes: string[]): number {
  if (likes.length === 0) return 0;
  const text = normalizeName(checkTextOf(meal).join(" "));
  let n = 0;
  for (const raw of likes) {
    const like = normalizeName(raw.toLowerCase().startsWith("other: ") ? raw.slice(7) : raw);
    if (like.length >= 3 && text.includes(like)) n++;
  }
  return n;
}

// Every candidate for the slot, scaled to the target. Nothing here knows the client's rules yet.
export function scaledCandidates(slot: Slot, target: SlotTarget, ctx: Pick<SelectionContext, "diet" | "coachRecipes">): ScaledMeal[] {
  const out: ScaledMeal[] = [];
  for (const recipe of templatesFor(slot, ctx.diet)) {
    const meal = scaleTemplate(recipe, target);
    if (meal) out.push(fromTemplateMeal(meal, recipe));
  }
  for (const recipe of ctx.coachRecipes) {
    if (recipe.slot !== slot && recipe.slot !== "any") continue;
    if (!recipe.diets.includes(ctx.diet)) continue;
    const meal = scaleLibraryRecipe(recipe, slot, target);
    if (meal) out.push(meal);
  }
  return out;
}

export function rankScore(meal: ScaledMeal, target: SlotTarget, ctx: SelectionContext): number {
  const fav = isFavorite(meal, ctx.favorites);
  let score = missScore(meal.macros, target) + meal.drift * 2;
  if (fav) score -= 100;
  score -= 2 * Math.min(3, likeHits(meal, ctx.likes));
  if (ctx.mixItUp && !fav) {
    const days = ctx.recentlyOffered.get(meal.key);
    if (days !== undefined && days < ctx.recentDays) score += 10 + (ctx.recentDays - days) * 0.5;
  }
  return score;
}

export function selectOptions(slot: Slot, target: SlotTarget, ctx: SelectionContext, count = OPTIONS_PER_SLOT): SlotSelection {
  const landed = scaledCandidates(slot, target, ctx).filter((m) => !ctx.excludeKeys?.has(m.key));
  // Two nets: the rules are checked on what the meal really contains (names, labels, the matched real food, preparation text), AND a saved recipe whose own allergen tags
  // name one of the client's allergies is never offered.
  const allergyKeys = allergyKeysOf(ctx.rules.allergies);
  const safe = landed.filter((m) => checkLines(checkTextOf(m), ctx.rules).length === 0 && !(m.allergenTags ?? []).some((t) => (allergyKeys as Set<string>).has(t)));
  const ranked = safe
    .map((m) => ({ m, s: rankScore(m, target, ctx) }))
    // Ties keep a stable order (by key), so the same inputs always give the same menu.
    .sort((a, b) => a.s - b.s || a.m.key.localeCompare(b.m.key))
    .map((x) => x.m);

  const picked: ScaledMeal[] = [];
  const families = new Set<string>();
  // First pass: different main proteins. Second pass: fill what is left in rank order.
  for (const m of ranked) {
    if (picked.length >= count) break;
    const family = m.mainProtein ?? m.key;
    if (families.has(family)) continue;
    families.add(family);
    picked.push(m);
  }
  for (const m of ranked) {
    if (picked.length >= count) break;
    if (!picked.includes(m)) picked.push(m);
  }
  // Keep the rank order inside the three (best first), whichever pass added it.
  picked.sort((a, b) => ranked.indexOf(a) - ranked.indexOf(b));
  return { options: picked, shortfall: Math.max(0, count - picked.length), landed: landed.length, leftOutForRules: landed.length - safe.length };
}
