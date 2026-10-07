import { describe, expect, it } from "vitest";
import { libraryRecipeFromRow, practicalGrams, scaleLibraryRecipe, solveFactors, MAX_FACTOR, MIN_FACTOR, type LibraryLine, type LibraryRecipe } from "./library-scaling";
import { checkTolerance } from "@/lib/meal-templates/tolerance";
import { proteinFamily, mainProteinOf } from "./main-protein";

const line = (over: Partial<LibraryLine> & Pick<LibraryLine, "id" | "label" | "role">): LibraryLine => ({
  proteinPer100g: 0,
  carbsPer100g: 0,
  fatPer100g: 0,
  fixedDisplayText: null,
  usdaFdcId: null,
  gramsRef: null,
  ...over,
});

// chicken (protein), rice (carb), olive oil (fat), a fixed side
const chickenBowl = (withRef = true): LibraryRecipe => ({
  id: "r1",
  name: "Chicken rice bowl",
  slot: "lunch",
  diets: ["omnivore"],
  keywords: ["chicken"],
  mainProtein: null,
  source: "coach",
  lines: [
    line({ id: "a", label: "Chicken breast", role: "protein_source", proteinPer100g: 23, fatPer100g: 2, gramsRef: withRef ? 180 : null }),
    line({ id: "b", label: "Jasmine rice", role: "carb_source", proteinPer100g: 2.5, carbsPer100g: 28, gramsRef: withRef ? 200 : null }),
    line({ id: "c", label: "Olive oil", role: "fat_source", fatPer100g: 100, gramsRef: withRef ? 10 : null }),
    line({ id: "d", label: "Greens", role: "fixed", fixedDisplayText: "1-2 cups" }),
  ],
});

describe("practical amounts", () => {
  it("whole grams under 25, the nearest 5 g above, never zero for a real amount", () => {
    expect(practicalGrams(0)).toBe(0);
    expect(practicalGrams(0.4)).toBe(1);
    expect(practicalGrams(12.4)).toBe(12);
    expect(practicalGrams(24.6)).toBe(25);
    expect(practicalGrams(137)).toBe(135);
    expect(practicalGrams(138)).toBe(140);
  });
});

describe("one factor per role", () => {
  it("keeps the factors inside 0.4 to 2.5 times the reference", () => {
    const f = solveFactors(chickenBowl().lines, { proteinG: 400, carbsG: 0, fatG: 0 });
    for (const v of Object.values(f)) {
      expect(v).toBeGreaterThanOrEqual(MIN_FACTOR);
      expect(v).toBeLessThanOrEqual(MAX_FACTOR);
    }
  });
  it("lands the recipe on its own reference macros at factor 1", () => {
    const r = chickenBowl();
    // chicken 180 g = 41.4 p / 3.6 f; rice 200 g = 5 p / 56 c; oil 10 g = 10 f
    const f = solveFactors(r.lines, { proteinG: 46.4, carbsG: 56, fatG: 13.6 });
    expect(f.protein_source).toBeCloseTo(1, 2);
    expect(f.carb_source).toBeCloseTo(1, 2);
    expect(f.fat_source).toBeCloseTo(1, 2);
  });
});

describe("scaling a coach's recipe to a slot", () => {
  it("lands inside the tolerance with amounts a person can weigh, and the macros are those of the printed lines", () => {
    const r = chickenBowl();
    const target = { proteinG: 50, carbsG: 60, fatG: 14 };
    const meal = scaleLibraryRecipe(r, "lunch", target);
    expect(meal).not.toBeNull();
    expect(checkTolerance(meal!.macros, target).ok).toBe(true);
    for (const l of meal!.lines.filter((x) => x.grams !== null)) expect(Number.isInteger(l.grams)).toBe(true);
    const chicken = meal!.lines.find((l) => l.name === "Chicken breast")!.grams!;
    const rice = meal!.lines.find((l) => l.name === "Jasmine rice")!.grams!;
    const oil = meal!.lines.find((l) => l.name === "Olive oil")!.grams!;
    const protein = (chicken * 23 + rice * 2.5) / 100;
    expect(meal!.macros.proteinG).toBeCloseTo(protein, 6);
    expect(meal!.displayLines.some((l) => l.includes("Greens"))).toBe(true);
    expect(meal!.mainProtein).toBe("chicken");
    expect(oil).toBeGreaterThan(0);
  });
  it("keeps the proportions inside a role: two carb sources move together", () => {
    const r = chickenBowl();
    r.lines.splice(2, 0, line({ id: "e", label: "Sweet potato", role: "carb_source", carbsPer100g: 20, proteinPer100g: 1.6, gramsRef: 100 }));
    const small = scaleLibraryRecipe(r, "lunch", { proteinG: 40, carbsG: 50, fatG: 12 });
    const big = scaleLibraryRecipe(r, "lunch", { proteinG: 40, carbsG: 90, fatG: 12 });
    expect(small).not.toBeNull();
    expect(big).not.toBeNull();
    const ratio = (m: NonNullable<typeof small>) => m.lines.find((l) => l.name === "Jasmine rice")!.grams! / m.lines.find((l) => l.name === "Sweet potato")!.grams!;
    expect(ratio(big!)).toBeGreaterThan(1.7);
    expect(ratio(big!)).toBeLessThan(2.3);
    expect(ratio(small!)).toBeGreaterThan(1.7);
    expect(ratio(small!)).toBeLessThan(2.3);
  });
  it("skips the recipe for a target it cannot reach, never shows a bad meal", () => {
    expect(scaleLibraryRecipe(chickenBowl(), "lunch", { proteinG: 150, carbsG: 0, fatG: 0 })).toBeNull();
    expect(scaleLibraryRecipe({ ...chickenBowl(), lines: [line({ id: "z", label: "Greens", role: "fixed", fixedDisplayText: "x" })] }, "lunch", { proteinG: 40, carbsG: 50, fatG: 12 })).toBeNull();
  });
  it("a recipe saved before reference grams is still scaled (the older way) and held to the same tolerance", () => {
    const meal = scaleLibraryRecipe(chickenBowl(false), "lunch", { proteinG: 40, carbsG: 50, fatG: 12 });
    // Either it lands (and is inside the tolerance) or it is skipped: never shown outside it.
    if (meal) expect(checkTolerance(meal.macros, { proteinG: 40, carbsG: 50, fatG: 12 }).ok).toBe(true);
  });
  it("the same inputs always give the same meal", () => {
    const t = { proteinG: 45, carbsG: 55, fatG: 13 };
    expect(JSON.stringify(scaleLibraryRecipe(chickenBowl(), "lunch", t))).toBe(JSON.stringify(scaleLibraryRecipe(chickenBowl(), "lunch", t)));
  });
});

describe("a database row as a library recipe", () => {
  it("reads a row with the new columns, and a row without them (before the release)", () => {
    const base = {
      id: "r9",
      name: "Row recipe",
      slot: "dinner",
      archetypes: ["keto"],
      keywords: ["x"],
      recipe_ingredients: [
        { id: "2", sort_order: 1, label: "Rice", role: "carb_source", protein_per_100g: 2, carbs_per_100g: 28, fat_per_100g: 0.3, fixed_display_text: null, usda_fdc_id: null },
        { id: "1", sort_order: 0, label: "Beef", role: "protein_source", protein_per_100g: "26", carbs_per_100g: 0, fat_per_100g: 10, fixed_display_text: null, usda_fdc_id: 123, grams_ref: 150 },
      ],
    };
    const old = libraryRecipeFromRow(base)!;
    expect(old.lines.map((l) => l.label)).toEqual(["Beef", "Rice"]);
    expect(old.lines[0].proteinPer100g).toBe(26);
    expect(old.lines[0].gramsRef).toBe(150);
    expect(old.lines[1].gramsRef).toBeNull();
    expect(old.source).toBe("coach");
    expect(old.diets).toEqual(["keto"]);
    const withNew = libraryRecipeFromRow({ ...base, source: "ai", main_protein: "beef" })!;
    expect(withNew.source).toBe("ai");
    expect(withNew.mainProtein).toBe("beef");
    expect(libraryRecipeFromRow({ ...base, recipe_ingredients: [] })).toBeNull();
    expect(libraryRecipeFromRow({ id: 5 })).toBeNull();
  });
});

describe("main protein", () => {
  it("names the family of the biggest protein line", () => {
    expect(proteinFamily("Chicken Breast")).toBe("chicken");
    expect(proteinFamily("NY Strip (Raw)")).toBe("beef");
    expect(proteinFamily("Atlantic salmon fillet")).toBe("salmon");
    expect(proteinFamily("Extra Firm Tofu")).toBe("tofu");
    expect(proteinFamily("Mystery paste")).toBe("mystery");
    expect(mainProteinOf([{ name: "Jasmine rice", proteinG: 5 }, { name: "Shrimp", proteinG: 30 }])).toBe("shellfish");
    expect(mainProteinOf([{ name: "Oil", proteinG: 0 }])).toBeNull();
  });
});
