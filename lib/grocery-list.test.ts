import { describe, expect, it } from "vitest";
import { compileGroceryList, displayFor, groceryListText, type PlanDay } from "@/lib/grocery-list";
import type { MealRecipeChoice } from "@/lib/meal-plan-assignment";
import type { MealLine } from "@/lib/meal-line";

const L = (name: string, foodKey: string, category: NonNullable<MealLine["category"]>, qty: number, unit: NonNullable<MealLine["unit"]>): MealLine => ({
  name,
  label: name,
  grams: unit === "g" ? qty : null,
  text: `<strong>${name}:</strong> ${qty}${unit === "g" ? "g" : " " + unit}`,
  foodKey,
  category,
  qty,
  unit,
});
const choice = (name: string, lines: MealLine[]): MealRecipeChoice => ({ recipeId: name, recipeName: name, ingredients: lines.map((l) => l.text ?? ""), lines });
const day = (date: string, entries: { mealId: string; recipes: MealRecipeChoice[]; featuredIndex?: number }[], carbCycling = false, bucket = "daily"): PlanDay => ({
  date,
  carbCycling,
  meals: { [bucket]: entries.map((e) => ({ title: e.mealId, proteinTarget: 0, carbsTarget: 0, fatTarget: 0, ...e })) },
});

const chicken = (g: number) => L("Chicken Breast", "chicken_breast", "proteins", g, "g");
const rice = (g: number) => L("Jasmine White Rice", "jasmine_rice_dry", "starches", g, "g");
const week = (entries: Parameters<typeof day>[1], n = 7) => Array.from({ length: n }, (_, i) => day(`2026-10-${String(5 + i).padStart(2, "0")}`, entries));

describe("compileGroceryList", () => {
  it("adds the featured option's lines across the days of the week", () => {
    const list = compileGroceryList(week([{ mealId: "1", recipes: [choice("A", [chicken(200), rice(80)])] }]));
    expect(list.daysCounted).toBe(7);
    const proteins = list.categories.find((c) => c.key === "proteins")!;
    expect(proteins.items[0]).toMatchObject({ name: "Chicken Breast", qty: 1400, unit: "g" });
    expect(list.categories.find((c) => c.key === "starches")!.items[0]).toMatchObject({ name: "Jasmine White Rice", qty: 560 });
  });
  it("counts the option the client's card shows first, not the first in the list", () => {
    const entry = { mealId: "1", recipes: [choice("A", [chicken(100)]), choice("B", [L("Atlantic Salmon", "salmon_raw", "proteins", 150, "g")])], featuredIndex: 1 };
    const list = compileGroceryList(week([entry], 2));
    expect(list.categories[0].items.map((i) => i.name)).toEqual(["Atlantic Salmon"]);
    expect(list.categories[0].items[0].qty).toBe(300);
  });
  it("split mode gives every option an equal share of the days", () => {
    const entry = { mealId: "1", recipes: [choice("A", [chicken(100)]), choice("B", [L("Atlantic Salmon", "salmon_raw", "proteins", 100, "g")])] };
    const list = compileGroceryList(week([entry], 4), { mode: "split" });
    const byName = Object.fromEntries(list.categories[0].items.map((i) => [i.name, i.qty]));
    expect(byName).toEqual({ "Atlantic Salmon": 200, "Chicken Breast": 200 });
  });
  it("a swapped line is what is counted (the swap rewrites the line)", () => {
    const swapped = choice("A", [L("Atlantic Salmon", "salmon_raw", "proteins", 180, "g")]);
    const list = compileGroceryList(week([{ mealId: "1", recipes: [swapped] }], 3));
    expect(list.categories[0].items.map((i) => i.name)).toEqual(["Atlantic Salmon"]);
    expect(list.categories[0].items[0].qty).toBe(540);
  });
  it("several meals and categories are grouped in the old app's order, each sorted by name", () => {
    const list = compileGroceryList(
      week([
        { mealId: "1", recipes: [choice("A", [chicken(100), L("Hass Avocado", "avocado_hass", "fats", 50, "g")])] },
        { mealId: "2", recipes: [choice("B", [L("Broccoli Florets", "broccoli_raw", "produce", 100, "g"), rice(100)])] },
      ], 1)
    );
    expect(list.categories.map((c) => c.key)).toEqual(["proteins", "starches", "fats", "produce"]);
  });
  it("carb cycling counts the training menu for the training-day share and the rest menu for the rest", () => {
    const d: PlanDay = {
      date: "2026-10-05",
      carbCycling: true,
      meals: {
        train: [{ mealId: "1", title: "1", proteinTarget: 0, carbsTarget: 0, fatTarget: 0, recipes: [choice("T", [rice(200)])] }],
        rest: [{ mealId: "1", title: "1", proteinTarget: 0, carbsTarget: 0, fatTarget: 0, recipes: [choice("R", [rice(100)])] }],
      },
    };
    const days = Array.from({ length: 7 }, (_, i) => ({ ...d, date: `2026-10-${5 + i}` }));
    const list = compileGroceryList(days, { trainingDaysPerWeek: 4 });
    // 4 training days at 200 g + 3 rest days at 100 g = 1,100 g
    expect(list.categories[0].items[0].qty).toBeCloseTo(1100, 6);
    expect(compileGroceryList(days, { trainingDaysPerWeek: 7 }).categories[0].items[0].qty).toBeCloseTo(1400, 6);
  });
  it("lists foods whose amounts are not kept instead of dropping them", () => {
    const old = choice("Old plan", []);
    old.ingredients = ["<strong>Greek yogurt:</strong> 200g", "Cook it"];
    const noAmounts: MealRecipeChoice = { recipeId: "r", recipeName: "Mine", ingredients: [], lines: [{ name: "Quinoa", label: "Quinoa", grams: 90 }] };
    const list = compileGroceryList(week([{ mealId: "1", recipes: [old] }, { mealId: "2", recipes: [noAmounts] }], 1));
    expect(list.categories).toEqual([]);
    expect(list.unstructured).toEqual(["Greek yogurt", "Quinoa"]);
  });
  it("an empty week is an empty list", () => {
    expect(compileGroceryList([])).toEqual({ categories: [], unstructured: [], daysCounted: 0 });
    expect(compileGroceryList([{ date: "2026-10-05", carbCycling: false, meals: {} }]).daysCounted).toBe(0);
  });
});

describe("one row per food, whatever it is printed as", () => {
  it("'Hard-Boiled Eggs' and 'Whole Eggs' are one row with one dozens figure", () => {
    const eggs = (name: string, n: number) => L(name, "egg_whole_large", "proteins", n, "large");
    const list = compileGroceryList([
      day("2026-10-05", [{ mealId: "1", recipes: [choice("A", [eggs("Whole Eggs", 6)])] }, { mealId: "2", recipes: [choice("B", [eggs("Hard-Boiled Eggs", 4)])] }]),
    ]);
    const items = list.categories[0].items;
    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({ name: "Whole Eggs", qty: 10 });
    expect(items[0].display).toBe("10 large (~1 dozen, ~500g)");
  });
  it("two names for spinach and for apples are one row each, and a swapped line merges with the same food", () => {
    const list = compileGroceryList([
      day("2026-10-05", [
        { mealId: "1", recipes: [choice("A", [L("Baby Spinach", "spinach_raw", "produce", 50, "g"), L("Apples", "apple_raw", "produce", 100, "g")])] },
        { mealId: "2", recipes: [choice("B", [L("Fresh Spinach", "spinach_raw", "produce", 30, "g"), L("Raw Apple", "apple_raw", "produce", 100, "g")])] },
      ]),
    ]);
    expect(list.categories[0].items.map((i) => [i.name, i.qty])).toEqual([["Apples", 200], ["Baby Spinach", 80]]);
  });
  it("the sourdough, egg white and bag rules follow the food, not the printed name", () => {
    expect(displayFor("Bread", 20, "slices", false, "sourdough_slice")).toBe("2 loaves (~20 slices needed, ~800g)");
    expect(displayFor("Egg Whites", 1200, "g", false, "egg_whites_liquid")).toBe("1200g (~3x 500g cartons)");
    expect(displayFor("Rice", 2500, "g", false, "jasmine_rice_dry")).toBe("2500g (~88.2 oz) → 10 lb bag");
    expect(displayFor("Rice Cakes", 10, "cakes", false, "rice_cake")).toBe("10 cakes (~90g)");
  });
});

describe("how a total reads", () => {
  it("whole eggs to dozens", () => expect(displayFor("Whole Eggs", 20, "large", false)).toBe("20 large (~2 dozen, ~1000g)"));
  it("liquid egg whites to 500 g cartons", () => expect(displayFor("Liquid Egg Whites", 1200, "g", false)).toBe("1200g (~3x 500g cartons)"));
  it("sourdough to loaves of 16 slices", () => {
    expect(displayFor("Sourdough Bread", 20, "slices", false)).toBe("2 loaves (~20 slices needed, ~800g)");
    expect(displayFor("Sourdough Bread", 3, "slices", false)).toBe("1 loaf (~3 slices needed, ~120g)");
  });
  it("rice and potatoes to bag sizes for a client who uses pounds, but not a rice cake, and not for metric", () => {
    expect(displayFor("Jasmine White Rice", 2500, "g", false)).toBe("2500g (~88.2 oz) → 10 lb bag");
    expect(displayFor("Russet Potatoes", 100, "g", false)).toBe("100g (~3.5 oz) → 5 lb bag");
    expect(displayFor("Russet Potatoes", 13000, "g", false)).toBe("13000g (~458.6 oz) → 2x 25 lb bags");
    expect(displayFor("Rice Cakes", 10, "cakes", false)).toBe("10 cakes (~90g)");
    expect(displayFor("Jasmine White Rice", 2500, "g", true)).toBe("2500g");
  });
  it("pieces are shown with an estimated weight", () => {
    expect(displayFor("Whole Wheat Wrap", 7, "wraps", false)).toBe("7 wraps (~350g)");
    expect(displayFor("String Cheese", 14, "pieces", false)).toBe("14 pieces (~336g)");
  });
  it("large weights also read in pounds and ounces, small ones do not", () => {
    expect(displayFor("Chicken Breast", 1400, "g", false)).toBe("1400g (~49.4 oz) (3 lb 1.4 oz)");
    expect(displayFor("Chicken Breast", 300, "g", false)).toBe("300g (~10.6 oz)");
    expect(displayFor("Chicken Breast", 1400, "g", true)).toBe("1400g");
  });
});

describe("groceryListText", () => {
  it("is plain text a coach can paste, with the unlisted foods at the end", () => {
    const list = compileGroceryList(week([{ mealId: "1", recipes: [choice("A", [chicken(200)])] }], 1));
    list.unstructured = ["Quinoa"];
    const text = groceryListText(list, "GROCERY LIST for Sam");
    expect(text).toContain("GROCERY LIST for Sam");
    expect(text).toContain("PROTEINS\n  Chicken Breast: 200g (~7.1 oz)");
    expect(text).toContain("ALSO IN THE PLAN (amounts not kept, check the plan)\n  Quinoa");
  });
});
