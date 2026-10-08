import type { FoodLogEntry } from "@/components/athlete/meal-checkoff-list";
import type { MealSlot } from "@/lib/food-entry";
import { trimDescription } from "@/lib/food-entry";
import { entryTooBigProblem } from "@/lib/food-validation";
import type { NutrientMap } from "@/lib/food-serving";

// A saved meal: a named group of foods the client logs again in one tap, at any number of servings. Each food is saved with its amount and the numbers FOR that amount, so logging
// the meal needs no lookup and an unchanged USDA record cannot shift an old meal.

export interface SavedMealItem {
  position: number;
  name: string;
  servingLabel: string | null;
  servingQty: number | null;
  amountG: number | null;
  calories: number;
  proteinG: number;
  carbsG: number;
  fatG: number;
  nutrients: NutrientMap | null;
  foodSource: string | null;
  fdcId: number | null;
}

export interface SavedMeal {
  id: string;
  name: string;
  items: SavedMealItem[];
}

const r1 = (n: number): number => Math.round(n * 10) / 10;
const r3 = (n: number): number => Math.round(n * 1000) / 1000;

// The foods of some logged entries as saved-meal items (skipped meals and entries with no numbers are left out).
export function itemsFromEntries(entries: FoodLogEntry[]): SavedMealItem[] {
  return entries
    .filter((e) => e.status !== "skipped" && e.calories != null)
    .map((e, i) => ({
      position: i,
      name: (e.description ?? "Food").slice(0, 160),
      servingLabel: e.servingLabel ?? null,
      servingQty: e.servingQty ?? null,
      amountG: e.amountG ?? null,
      calories: e.calories ?? 0,
      proteinG: e.proteinG ?? 0,
      carbsG: e.carbsG ?? 0,
      fatG: e.fatG ?? 0,
      nutrients: e.nutrients ?? null,
      foodSource: e.foodSource ?? null,
      fdcId: e.fdcId ?? null,
    }));
}

export function itemInsertRow(mealId: string, item: SavedMealItem) {
  return {
    meal_id: mealId,
    position: item.position,
    name: item.name,
    serving_label: item.servingLabel,
    serving_qty: item.servingQty,
    amount_g: item.amountG,
    calories: item.calories,
    protein_g: item.proteinG,
    carbs_g: item.carbsG,
    fat_g: item.fatG,
    nutrients: item.nutrients,
    food_source: item.foodSource,
    fdc_id: item.fdcId,
  };
}

export interface SavedMealItemRow {
  position: number;
  name: string;
  serving_label: string | null;
  serving_qty: number | string | null;
  amount_g: number | string | null;
  calories: number | string;
  protein_g: number | string;
  carbs_g: number | string;
  fat_g: number | string;
  nutrients: NutrientMap | null;
  food_source: string | null;
  fdc_id: number | null;
}
export const SAVED_MEAL_ITEM_SELECT = "position, name, serving_label, serving_qty, amount_g, calories, protein_g, carbs_g, fat_g, nutrients, food_source, fdc_id";

export function itemFromRow(r: SavedMealItemRow): SavedMealItem {
  const n = (v: number | string | null) => (v == null ? null : Number(v));
  return {
    position: r.position,
    name: r.name,
    servingLabel: r.serving_label,
    servingQty: n(r.serving_qty),
    amountG: n(r.amount_g),
    calories: Number(r.calories),
    proteinG: Number(r.protein_g),
    carbsG: Number(r.carbs_g),
    fatG: Number(r.fat_g),
    nutrients: r.nutrients,
    foodSource: r.food_source,
    fdcId: r.fdc_id,
  };
}

export const MAX_MEAL_SERVINGS = 20;
export function mealServingsProblem(m: number): string | null {
  if (!Number.isFinite(m) || m <= 0) return "Enter a number of servings greater than zero.";
  if (m > MAX_MEAL_SERVINGS) return `That is more than ${MAX_MEAL_SERVINGS} servings of a meal. Check the amount.`;
  return null;
}

// The totals of a meal at a number of servings.
export function mealTotals(items: SavedMealItem[], servings = 1): { calories: number; proteinG: number; carbsG: number; fatG: number } {
  const t = items.reduce((a, i) => ({ calories: a.calories + i.calories, proteinG: a.proteinG + i.proteinG, carbsG: a.carbsG + i.carbsG, fatG: a.fatG + i.fatG }), { calories: 0, proteinG: 0, carbsG: 0, fatG: 0 });
  return { calories: Math.round(t.calories * servings), proteinG: r1(t.proteinG * servings), carbsG: r1(t.carbsG * servings), fatG: r1(t.fatG * servings) };
}

// Checks every food of the meal at this number of servings BEFORE anything is saved (the rows go in as one batch, so one too-big food would fail them all). Names the food.
export function mealEntryProblem(meal: SavedMeal, servings: number): string | null {
  for (const i of meal.items) {
    const p = entryTooBigProblem({ calories: i.calories * servings, proteinG: i.proteinG * servings, carbsG: i.carbsG * servings, fatG: i.fatG * servings });
    if (p) return `${i.name}: ${p}`;
  }
  return null;
}

// One food log row per food in the meal, scaled by the number of servings. Calories are whole numbers; every nutrient keeps its fraction.
export function mealEntryRows(args: { athleteId: string; groupId: string; logDate: string; mealSlot: MealSlot | null; meal: SavedMeal; servings: number }) {
  const m = args.servings;
  return args.meal.items.map((i) => {
    const row: Record<string, unknown> = {
      athlete_id: args.athleteId,
      group_id: args.groupId,
      log_date: args.logDate,
      meal_slot: args.mealSlot,
      status: "quick_log",
      description: trimDescription(i.name),
      calories: Math.round(i.calories * m),
      protein_g: r1(i.proteinG * m),
      carbs_g: r1(i.carbsG * m),
      fat_g: r1(i.fatG * m),
    };
    // The detail goes along only when the food has it, so a meal saved from old-style entries logs with exactly the old columns.
    const detail: Record<string, unknown> = {
      food_source: i.foodSource,
      fdc_id: i.fdcId,
      amount_g: i.amountG != null ? r1(i.amountG * m) : null,
      serving_label: i.servingLabel,
      serving_qty: i.servingQty != null ? Math.round(i.servingQty * m * 100) / 100 : null,
      nutrients: i.nutrients ? Object.fromEntries(Object.entries(i.nutrients).map(([k, v]) => [k, r3(v * m)])) : null,
    };
    for (const [k, v] of Object.entries(detail)) if (v != null) row[k] = v;
    return row;
  });
}
