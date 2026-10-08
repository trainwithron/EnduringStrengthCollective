import { describe, expect, it } from "vitest";
import type { FoodLogEntry } from "@/components/athlete/meal-checkoff-list";
import { copyRows, defaultMealSlot, entryFromRow, fetchFoodLogDay, rescaleEntryPatch, trimDescription, usdaEntryRow } from "@/lib/food-entry";

describe("defaultMealSlot", () => {
  it("follows the clock", () => {
    expect(defaultMealSlot(7)).toBe("breakfast");
    expect(defaultMealSlot(10, 29)).toBe("breakfast");
    expect(defaultMealSlot(12)).toBe("lunch");
    expect(defaultMealSlot(15)).toBe("snack");
    expect(defaultMealSlot(19)).toBe("dinner");
    expect(defaultMealSlot(22)).toBe("snack");
  });
});

describe("usdaEntryRow", () => {
  const row = usdaEntryRow({
    athleteId: "a1",
    groupId: "g1",
    logDate: "2026-10-08",
    mealSlot: "lunch",
    fdcId: 169756,
    description: "Rice, white, long-grain, regular, enriched, cooked",
    servingLabel: "1 cup",
    servingQty: 1.5,
    grams: 237,
    per100g: { kcal: 130, protein_g: 2.69, carbs_g: 28.17, fat_g: 0.28, fiber_g: 0.4 },
  });
  it("stores the amount, serving, food and macros for that amount", () => {
    expect(row).toMatchObject({ athlete_id: "a1", group_id: "g1", log_date: "2026-10-08", meal_slot: "lunch", status: "quick_log", food_source: "usda", fdc_id: 169756, amount_g: 237, serving_label: "1 cup", serving_qty: 1.5 });
    expect(row.calories).toBe(308);
    expect(row.protein_g).toBe(6.4);
    expect(row.carbs_g).toBe(66.8);
  });
  it("snapshots every nutrient the food reports, for the amount, and nothing it does not", () => {
    expect(row.nutrients.fiber_g).toBeCloseTo(0.948, 3);
    expect("sodium_mg" in row.nutrients).toBe(false);
  });
});

describe("rescaleEntryPatch", () => {
  const entry: FoodLogEntry = {
    id: "e1", mealSlot: "lunch", status: "quick_log", description: "Rice", calories: 205, proteinG: 4.3, carbsG: 44.6, fatG: 0.4,
    foodSource: "usda", fdcId: 1, amountG: 158, servingLabel: "1 cup", servingQty: 1, nutrients: { kcal: 205.4, protein_g: 4.27, carbs_g: 44.51, fat_g: 0.44 },
  };
  it("re-scales calories, macros and every nutrient for a different number of servings", () => {
    const p = rescaleEntryPatch(entry, 1.5)!;
    expect(p.amount_g).toBe(237);
    expect(p.serving_qty).toBe(1.5);
    expect(p.calories).toBe(308);
    expect(p.nutrients.kcal).toBeCloseTo(308.1, 1);
  });
  it("refuses an entry with no snapshot, and zero or absurd amounts", () => {
    expect(rescaleEntryPatch({ ...entry, nutrients: null }, 2)).toBeNull();
    expect(rescaleEntryPatch(entry, 0)).toBeNull();
    expect(rescaleEntryPatch(entry, 100000)).toBeNull();
  });
});

describe("copyRows", () => {
  const plain: FoodLogEntry = { id: "e1", mealSlot: "breakfast", status: "quick_log", description: "Toast", calories: 120, proteinG: 4, carbsG: 20, fatG: 2 };
  const searched: FoodLogEntry = { ...plain, id: "e2", description: "Rice", foodSource: "usda", fdcId: 9, amountG: 100, servingLabel: "grams", servingQty: 100, nutrients: { kcal: 130 } };
  const skipped: FoodLogEntry = { ...plain, id: "e3", status: "skipped", calories: null };
  const planned: FoodLogEntry = { ...plain, id: "e4", status: "ate_it", description: "Planned lunch", mealSlot: "lunch" };
  const opts = { athleteId: "a1", groupId: "g1", toDate: "2026-10-09" };

  it("copies to the new day as plain logged foods, skipping skipped meals", () => {
    const rows = copyRows([plain, skipped, planned], opts);
    expect(rows).toHaveLength(2);
    expect(rows.every((r) => r.status === "quick_log" && r.log_date === "2026-10-09" && r.athlete_id === "a1")).toBe(true);
    expect(rows[1].meal_slot).toBe("lunch");
  });
  it("an entry logged the old way copies exactly the old columns (so copying works before the detail columns exist)", () => {
    const [row] = copyRows([plain], opts);
    expect(Object.keys(row).sort()).toEqual(["athlete_id", "calories", "carbs_g", "description", "fat_g", "group_id", "log_date", "meal_slot", "protein_g", "status"]);
  });
  it("a searched food keeps its detail", () => {
    const [row] = copyRows([searched], opts);
    expect(row).toMatchObject({ food_source: "usda", fdc_id: 9, amount_g: 100, serving_label: "grams", serving_qty: 100, nutrients: { kcal: 130 } });
  });
  it("can move the copy to another meal", () => {
    expect(copyRows([plain], { ...opts, mealSlot: "dinner" })[0].meal_slot).toBe("dinner");
    expect(copyRows([plain], { ...opts, mealSlot: null })[0].meal_slot).toBeNull();
  });
});

describe("entryFromRow", () => {
  it("maps database columns to the entry, with absent detail as null", () => {
    expect(entryFromRow({ id: "x", meal_slot: null, status: "quick_log", description: "d", calories: 1, protein_g: 2, carbs_g: 3, fat_g: 4 })).toMatchObject({ id: "x", foodSource: null, fdcId: null, amountG: null, nutrients: null });
  });
});

describe("trimDescription", () => {
  it("keeps names at 160 characters", () => {
    expect(trimDescription("a".repeat(200))).toHaveLength(160);
    expect(trimDescription("short")).toBe("short");
  });
});

describe("fetchFoodLogDay", () => {
  function fake(detailFails: boolean) {
    const calls: string[] = [];
    const client = {
      from: () => ({
        select: (cols: string) => {
          calls.push(cols);
          const rows = detailFails && cols.includes("fdc_id") ? { data: null, error: { message: "column does not exist" } } : { data: [{ id: "e1", meal_slot: null, status: "quick_log", description: "x", calories: 1, protein_g: 1, carbs_g: 1, fat_g: 1 }], error: null };
          const chain: Record<string, unknown> = { eq: () => chain, order: () => Promise.resolve(rows) };
          return chain;
        },
      }),
    } as never;
    return { client, calls };
  }
  it("falls back to the original columns before the database has the detail columns", async () => {
    const { client, calls } = fake(true);
    const out = await fetchFoodLogDay(client, "a1", "2026-10-08");
    expect(out).toHaveLength(1);
    expect(calls).toHaveLength(2);
    expect(calls[1]).not.toContain("fdc_id");
  });
  it("reads the detail columns when they exist", async () => {
    const { client, calls } = fake(false);
    await fetchFoodLogDay(client, "a1", "2026-10-08");
    expect(calls).toHaveLength(1);
    expect(calls[0]).toContain("nutrients");
  });
});
