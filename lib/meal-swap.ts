import { EXTRA_NAME_TO_KEY, FOOD_ARCHETYPES, FOOD_DENSITY, NAME_TO_KEY, PER_UNIT_KEYS, TRAINING_DAY_ONLY_KEYS, UNIT_WEIGHT_G, toOz, stripOunceHints, type DietType, type FoodCategory, type ItemUnit } from "@/lib/meal-templates";
import { checkLines, type FoodRules } from "@/lib/allergen-check";
import { caloriesOf, ingredientMacros } from "@/lib/meal-templates/macros";
import { isStructuredLine, type MealLine, type MealSwap } from "@/lib/meal-line";
import type { MealOption } from "@/lib/meal-engine";
import { proteinFamily } from "@/lib/main-protein";

// Ingredient swap ("change this"), ported from Ron's Mix & Macros app (docs/old-app/enduring-strength-collective-checkin-engine.html, getSwapOptions / applySwapsToItems / chooseSwap).
// A coach changes one food in a meal for another food of the SAME KIND that fits the client's diet; the amount of the new food is worked out so it supplies the same macro the old one
// did (not a re-solve of the whole meal), a food counted in whole units (an egg, a slice, a wrap, a rice cake) is never less than one, and a produce portion is capped at a realistic
// size. A swap into something that breaks the client's allergies or food rules is refused. Pure: no database, no network.

export type SwapRole = "protein" | "carbs" | "fat" | "veggie";
const CATEGORY_TO_ROLE: Partial<Record<FoodCategory, SwapRole>> = { proteins: "protein", starches: "carbs", fats: "fat", produce: "veggie" };
export const ROLE_LABEL: Record<SwapRole, string> = { protein: "Protein", carbs: "Carb", fat: "Fat", veggie: "Veggie or fruit" };
// Produce is macro-matched on its carbs, the same field a starch uses (but kept a separate role so a starch swap and a produce swap in one meal never mix).
const ROLE_FIELD: Record<SwapRole, "protein" | "carbs" | "fat"> = { protein: "protein", carbs: "carbs", fat: "fat", veggie: "carbs" };
// Foods counted in whole units, and the unit each is counted in.
const UNIT_OF_KEY: Record<string, ItemUnit> = { sourdough_slice: "slices", whole_wheat_wrap: "wraps", rice_cake: "cakes", egg_whole_large: "large" };
export const MAX_VEGGIE_SWAP_G = 450;

export const roleOfCategory = (c: FoodCategory | undefined): SwapRole | null => (c ? CATEGORY_TO_ROLE[c] ?? null : null);

// The name a food key prints under (the first name the old table mapped to it).
export function displayNameOfKey(key: string): string {
  return Object.keys(NAME_TO_KEY).find((n) => NAME_TO_KEY[n] === key) ?? Object.keys(EXTRA_NAME_TO_KEY).find((n) => EXTRA_NAME_TO_KEY[n] === key) ?? key;
}

export interface SwapChoice {
  key: string;
  name: string;
  trainingDayOnly: boolean;
}

// Every food that can stand in for `role` for this diet, by name. The quick, sugar-heavy carbs (honey, fruit juice) are offered only on a training day.
export function swapChoices(role: SwapRole, diet: DietType, trainingDay: boolean): SwapChoice[] {
  const seen = new Set<string>();
  const out: SwapChoice[] = [];
  const names = [...Object.keys(NAME_TO_KEY).map((n) => [n, NAME_TO_KEY[n]] as const), ...Object.keys(EXTRA_NAME_TO_KEY).map((n) => [n, EXTRA_NAME_TO_KEY[n]] as const)];
  for (const [name, key] of names) {
    if (seen.has(key)) continue;
    const density = FOOD_DENSITY[key as keyof typeof FOOD_DENSITY];
    if (!density || roleOfCategory(density.category) !== role) continue;
    if (!(FOOD_ARCHETYPES[key] ?? []).includes(diet)) continue;
    if (TRAINING_DAY_ONLY_KEYS.has(key) && !trainingDay) continue;
    seen.add(key);
    out.push({ key, name, trainingDayOnly: TRAINING_DAY_ONLY_KEYS.has(key) });
  }
  return out.sort((a, b) => a.name.localeCompare(b.name));
}

// The same list with everything that breaks the client's allergies, intolerances, dislikes or diet taken out, so the picker never even shows a food the client cannot have.
export function safeSwapChoices(role: SwapRole, diet: DietType, trainingDay: boolean, rules: FoodRules | null): SwapChoice[] {
  if (!rules) return [];
  return swapChoices(role, diet, trainingDay).filter((c) => checkLines([c.name], rules).length === 0);
}

export type SwapResult = { ok: true; option: MealOption } | { ok: false; reason: string };

// The line as it is printed on the plan: "<strong>Name:</strong> 120g (~4.2 oz)" or "<strong>Name:</strong> 3 large". Metric clients get no ounce hint.
export function printLine(name: string, qty: number, unit: ItemUnit, metric = false): string {
  const qtyLabel = unit === "g" ? `${qty}g` : `${qty} ${unit}`;
  const raw = `<strong>${name}:</strong> ${qtyLabel}${unit === "g" ? ` ${toOz(qty)}` : ""}`;
  return metric ? stripOunceHints(raw) : raw;
}

const plain = (html: string) => html.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();

// The macros one structured line carries (null when its food is not in the table).
export function lineMacros(line: MealLine) {
  if (!isStructuredLine(line)) return null;
  return ingredientMacros({ name: line.name, category: line.category, qty: line.qty, unit: line.unit, text: line.text });
}

// Whether a line can be swapped at all: it is structured, in a role that has swaps, and its food is one the table knows.
export function swappableRole(line: MealLine): SwapRole | null {
  if (!isStructuredLine(line)) return null;
  const role = roleOfCategory(line.category);
  if (!role || !(line.foodKey in FOOD_DENSITY)) return null;
  return role;
}

export interface SwapContext {
  diet: DietType;
  trainingDay: boolean;
  rules: FoodRules | null;
  // Metric clients see no ounce hints.
  metric?: boolean;
}

// Replaces line `lineIndex` of `option` with `newKey` and returns the changed option (never mutates the original): the printed line, the structured line, the macros and the swap
// record. Refuses a food that is not offered for this role and diet, one that breaks the client's rules, and a line that cannot be swapped.
export function applySwap(option: MealOption, lineIndex: number, newKey: string, ctx: SwapContext): SwapResult {
  const lines = option.lines ?? [];
  const line = lines[lineIndex];
  if (!line) return { ok: false, reason: "That line is not in this meal." };
  const role = swappableRole(line);
  if (!role || !isStructuredLine(line)) return { ok: false, reason: "This food cannot be swapped." };
  if (!ctx.rules) return { ok: false, reason: "This client's food rules could not be read, so nothing can be swapped." };
  const offered = swapChoices(role, ctx.diet, ctx.trainingDay).find((c) => c.key === newKey);
  if (!offered) return { ok: false, reason: `${displayNameOfKey(newKey)} is not an option for this kind of food and this client's way of eating.` };
  const hits = checkLines([offered.name], ctx.rules);
  if (hits.length > 0) {
    const h = hits[0];
    const why = h.kind === "allergy" ? `an allergy (${h.label})` : h.kind === "intolerance" ? `an intolerance (${h.label})` : h.kind === "diet" ? `this client's ${h.label} diet` : `a food they dislike (${h.label})`;
    return { ok: false, reason: `${offered.name} breaks ${why}.` };
  }
  if (newKey === line.foodKey) return { ok: false, reason: "That is already the food in this meal." };

  const oldDensity = FOOD_DENSITY[line.foodKey as keyof typeof FOOD_DENSITY];
  const newDensity = FOOD_DENSITY[newKey as keyof typeof FOOD_DENSITY];
  const field = ROLE_FIELD[role];
  if (!oldDensity || !newDensity || !(newDensity[field] > 0)) return { ok: false, reason: "That food cannot stand in for this one." };
  // Freeze the macro this line was supplying, then find how much of the new food supplies the same. Whole-unit foods are floored at one; a produce portion is capped.
  const macroTarget = line.qty * (oldDensity[field] || 0);
  const rawQty = macroTarget / newDensity[field];
  const newQty = role === "veggie" ? Math.min(Math.max(1, Math.round(rawQty)), MAX_VEGGIE_SWAP_G) : Math.max(1, Math.round(rawQty));
  const unit: ItemUnit = UNIT_OF_KEY[newKey] ?? "g";
  const text = printLine(offered.name, newQty, unit, !!ctx.metric);
  const grams = PER_UNIT_KEYS.has(newKey as never) ? null : unit === "g" ? newQty : unit === "pieces" ? newQty * UNIT_WEIGHT_G.pieces : null;
  const newLine: MealLine = { name: offered.name, label: offered.name, grams, text, foodKey: newKey, category: newDensity.category, qty: newQty, unit };

  // The printed line: replace exactly the string that was printed for the old line.
  const ingredients = [...option.ingredients];
  let at = ingredients.findIndex((s) => s === line.text);
  if (at < 0) at = ingredients.findIndex((s) => plain(s).toLowerCase().startsWith(line.label.toLowerCase()));
  if (at < 0) return { ok: false, reason: "That line could not be found in the printed meal." };
  ingredients[at] = text;

  const newLines = lines.map((l, i) => (i === lineIndex ? newLine : l));
  const before = lineMacros(line);
  const after = lineMacros(newLine);
  let macros = option.macros;
  if (macros && before && after) {
    const proteinG = Math.round(macros.proteinG - before.proteinG + after.proteinG);
    const carbsG = Math.round(macros.carbsG - before.carbsG + after.carbsG);
    const fatG = Math.round(macros.fatG - before.fatG + after.fatG);
    macros = { proteinG, carbsG, fatG, calories: Math.round(caloriesOf(proteinG, carbsG, fatG)) };
  }
  const swaps: MealSwap[] = [...(option.swaps ?? []), { from: line.name, to: offered.name }];
  // The protein family is re-read when every counted line is structured (so it follows a protein swap); otherwise it is left as it was.
  let mainProtein = option.mainProtein;
  if (newLines.every((l) => isStructuredLine(l))) {
    let best: { name: string; proteinG: number } | null = null;
    for (const l of newLines) {
      const m = lineMacros(l);
      if (m && m.proteinG > 0 && (!best || m.proteinG > best.proteinG)) best = { name: l.name, proteinG: m.proteinG };
    }
    if (best) mainProtein = proteinFamily(best.name);
  }
  return { ok: true, option: { ...option, ingredients, lines: newLines, macros, swaps, mainProtein } };
}
