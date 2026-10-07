// What a template meal really contains: the macros of EVERY line that is part of the meal (shown and counted), from the food table. This is what the checks, the
// tolerance and the scaler all use, so a fixed side (a set 150 g of broccoli) can never be left out of the total.
import { FOOD_DENSITY, PER_UNIT_KEYS, UNIT_WEIGHT_G, type FoodKey } from "./food-table";
import { EXTRA_NAME_TO_KEY, NAME_TO_KEY } from "./food-names";
import { isIngredient, type TemplateIngredient, type TemplateItem } from "./types";

export interface Macros {
  proteinG: number;
  carbsG: number;
  fatG: number;
  calories: number;
}

export const ZERO_MACROS: Macros = { proteinG: 0, carbsG: 0, fatG: 0, calories: 0 };

export const caloriesOf = (proteinG: number, carbsG: number, fatG: number): number => 4 * proteinG + 4 * carbsG + 9 * fatG;

// The food-table key an ingredient name stands for, or null when the name is not a known food.
export function foodKeyOf(name: string): FoodKey | null {
  return NAME_TO_KEY[name] ?? EXTRA_NAME_TO_KEY[name] ?? null;
}

// Grams in a line (null for a food counted in whole units, whose density is per unit).
export function ingredientGrams(item: TemplateIngredient): number | null {
  const key = foodKeyOf(item.name);
  if (key && PER_UNIT_KEYS.has(key)) return null;
  if (item.unit === "g") return item.qty;
  if (item.unit === "pieces") return item.qty * UNIT_WEIGHT_G.pieces;
  return null;
}

export function ingredientMacros(item: TemplateIngredient): Macros | null {
  const key = foodKeyOf(item.name);
  if (!key) return null;
  const d = FOOD_DENSITY[key];
  // A per-unit food is counted in its own units; any other food is counted in grams (a piece of string cheese is a set weight).
  const amount = PER_UNIT_KEYS.has(key) ? item.qty : item.unit === "pieces" ? item.qty * UNIT_WEIGHT_G.pieces : item.qty;
  const proteinG = amount * d.protein;
  const carbsG = amount * d.carbs;
  const fatG = amount * d.fat;
  return { proteinG, carbsG, fatG, calories: caloriesOf(proteinG, carbsG, fatG) };
}

// The ingredient lines that are part of the meal: named, with an amount worth showing (a blank text means "too small to show", so not shown and not counted).
export const mealIngredients = (items: TemplateItem[]): TemplateIngredient[] => items.filter(isIngredient).filter((i) => i.text.trim() !== "");

export function mealMacros(items: TemplateItem[]): { macros: Macros; unknown: string[] } {
  let proteinG = 0;
  let carbsG = 0;
  let fatG = 0;
  const unknown: string[] = [];
  for (const item of mealIngredients(items)) {
    const m = ingredientMacros(item);
    if (!m) {
      unknown.push(item.name);
      continue;
    }
    proteinG += m.proteinG;
    carbsG += m.carbsG;
    fatG += m.fatG;
  }
  return { macros: { proteinG, carbsG, fatG, calories: caloriesOf(proteinG, carbsG, fatG) }, unknown };
}
