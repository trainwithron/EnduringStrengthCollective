import { describe, expect, it } from "vitest";
import type { FoodLogEntry } from "@/components/athlete/meal-checkoff-list";
import { itemFromRow, itemInsertRow, itemsFromEntries, mealEntryRows, mealServingsProblem, mealTotals, type SavedMeal } from "@/lib/saved-meal";

const oats: FoodLogEntry = { id: "e1", mealSlot: "breakfast", status: "quick_log", description: "Oats, dry", calories: 307, proteinG: 10.7, carbsG: 54.8, fatG: 5.3, foodSource: "usda", fdcId: 5, amountG: 81, servingLabel: "1 cup", servingQty: 1, nutrients: { kcal: 307, protein_g: 10.7, fiber_g: 8.2 } };
const coffee: FoodLogEntry = { id: "e2", mealSlot: "breakfast", status: "quick_log", description: "Coffee with milk", calories: 30, proteinG: 1.5, carbsG: 2, fatG: 1.5 };
const skipped: FoodLogEntry = { id: "e3", mealSlot: "breakfast", status: "skipped", description: "Skipped", calories: null, proteinG: null, carbsG: null, fatG: null };

describe("itemsFromEntries", () => {
  it("saves each logged food with its amount and numbers, leaving out skipped meals", () => {
    const items = itemsFromEntries([oats, skipped, coffee]);
    expect(items).toHaveLength(2);
    expect(items[0]).toMatchObject({ position: 0, name: "Oats, dry", calories: 307, amountG: 81, foodSource: "usda", fdcId: 5, nutrients: { fiber_g: 8.2, kcal: 307, protein_g: 10.7 } });
    expect(items[1]).toMatchObject({ position: 1, name: "Coffee with milk", servingLabel: null, nutrients: null, foodSource: null });
  });
});

describe("mealTotals", () => {
  const items = itemsFromEntries([oats, coffee]);
  it("adds the foods and scales by servings", () => {
    expect(mealTotals(items)).toEqual({ calories: 337, proteinG: 12.2, carbsG: 56.8, fatG: 6.8 });
    expect(mealTotals(items, 2)).toEqual({ calories: 674, proteinG: 24.4, carbsG: 113.6, fatG: 13.6 });
    expect(mealTotals(items, 0.5).calories).toBe(169);
  });
  it("is zero for no foods", () => {
    expect(mealTotals([])).toEqual({ calories: 0, proteinG: 0, carbsG: 0, fatG: 0 });
  });
});

describe("mealEntryRows", () => {
  const meal: SavedMeal = { id: "m1", name: "Usual breakfast", items: itemsFromEntries([oats, coffee]) };
  const args = { athleteId: "a1", groupId: "g1", logDate: "2026-10-08", mealSlot: "breakfast" as const, meal };
  it("logs one entry per food, to the chosen meal and day", () => {
    const rows = mealEntryRows({ ...args, servings: 1 });
    expect(rows).toHaveLength(2);
    expect(rows.every((r) => r.log_date === "2026-10-08" && r.meal_slot === "breakfast" && r.status === "quick_log" && r.athlete_id === "a1")).toBe(true);
    expect(rows[0]).toMatchObject({ description: "Oats, dry", calories: 307, food_source: "usda", fdc_id: 5, amount_g: 81, serving_qty: 1 });
  });
  it("scales calories, macros, weight, servings and every nutrient", () => {
    const [first] = mealEntryRows({ ...args, servings: 1.5 });
    expect(first).toMatchObject({ calories: 461, protein_g: 16, carbs_g: 82.2, fat_g: 8, amount_g: 121.5, serving_qty: 1.5 });
    expect(first.nutrients).toEqual({ kcal: 460.5, protein_g: 16.05, fiber_g: 12.3 });
  });
  it("a food saved without detail logs with exactly the old columns", () => {
    const rows = mealEntryRows({ ...args, servings: 1 });
    expect(Object.keys(rows[1]).sort()).toEqual(["athlete_id", "calories", "carbs_g", "description", "fat_g", "group_id", "log_date", "meal_slot", "protein_g", "status"]);
  });
});

describe("rows and limits", () => {
  it("maps an item to and from the database", () => {
    const [item] = itemsFromEntries([oats]);
    const row = itemInsertRow("m1", item);
    expect(row).toMatchObject({ meal_id: "m1", position: 0, name: "Oats, dry", amount_g: 81, fdc_id: 5 });
    expect(itemFromRow({ position: 0, name: "x", serving_label: null, serving_qty: "1.5", amount_g: "81", calories: "307", protein_g: "10.7", carbs_g: "54.8", fat_g: "5.3", nutrients: null, food_source: null, fdc_id: null })).toMatchObject({ servingQty: 1.5, amountG: 81, calories: 307 });
  });
  it("refuses zero or absurd servings of a meal", () => {
    expect(mealServingsProblem(0)).not.toBeNull();
    expect(mealServingsProblem(2)).toBeNull();
    expect(mealServingsProblem(21)).toContain("20 servings");
  });
});
