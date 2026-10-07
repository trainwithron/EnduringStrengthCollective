import { describe, expect, it } from "vitest";
import { ALLERGEN_KEYS } from "@/lib/allergen-check";
import { DIET_TYPES as PREFERENCE_DIET_TYPES } from "@/lib/nutrition-preferences";
import { DISABLED_TEMPLATES } from "./disabled";
import { ENABLED_TEMPLATES, RECIPES, templatesFor } from "./index";
import { FOOD_DENSITY, PER_UNIT_KEYS } from "./food-table";
import { EXTRA_NAME_TO_KEY, FOOD_ARCHETYPES, NAME_TO_KEY } from "./food-names";
import { familiesOf, familiesOfDiet, gridFor, SCALES } from "./grid";
import { foodKeyOf, ingredientMacros, mealIngredients, mealMacros } from "./macros";
import { renderLines, stripOunceHints, toOz } from "./render";
import { scaleTemplate } from "./scale";
import { dietProblems, templateAllergens } from "./tags";
import { checkTolerance } from "./tolerance";
import { DIET_TYPES, SLOTS, isIngredient, type TemplateRecipe } from "./types";

// The permanent check on the ported recipe library (the old app's "Diagnostics", made strict). Every recipe is built across a spread of slot targets, for every diet
// it declares, and what comes out is measured from the food table, line by line.

// The old app's own five extreme targets (near zero, very high, zero carbs).
const OLD_MACRO_SETS = [
  { p: 20, c: 15, f: 8 },
  { p: 40, c: 50, f: 15 },
  { p: 70, c: 120, f: 30 },
  { p: 150, c: 250, f: 60 },
  { p: 80, c: 0, f: 40 },
];

// How many of the six target sizes a recipe lands on, in the best target shape it is served on.
function bestPasses(r: TemplateRecipe): number {
  return Math.max(...familiesOf(r.archetypes).map((fam) => gridFor(fam, r.slot).filter((t) => scaleTemplate(r, t) !== null).length));
}

describe("the library is what the old app had", () => {
  it("has 66 recipes: 20 breakfast, 19 lunch, 19 dinner, 8 snack, unique ids", () => {
    expect(RECIPES).toHaveLength(66);
    const count = (slot: string) => RECIPES.filter((r) => r.slot === slot).length;
    expect([count("breakfast"), count("lunch"), count("dinner"), count("snack")]).toEqual([20, 19, 19, 8]);
    expect(new Set(RECIPES.map((r) => r.id)).size).toBe(66);
  });
  it("every recipe has a name, at least one real diet, keywords and a slot", () => {
    for (const r of RECIPES) {
      expect(r.name.length, r.id).toBeGreaterThan(3);
      expect(r.archetypes.length, r.id).toBeGreaterThan(0);
      for (const a of r.archetypes) expect(DIET_TYPES, `${r.id} ${a}`).toContain(a);
      expect(r.keywords.length, r.id).toBeGreaterThan(0);
      expect(SLOTS).toContain(r.slot);
    }
  });
  it("uses the same seven diet types as the client's Preferences and the diet checks, pescatarian included", () => {
    expect([...DIET_TYPES].sort()).toEqual([...PREFERENCE_DIET_TYPES].sort());
  });
  it("covers every diet the old app declared, pescatarian included", () => {
    for (const d of DIET_TYPES) expect(RECIPES.some((r) => r.archetypes.includes(d)), d).toBe(true);
    expect(RECIPES.filter((r) => r.archetypes.includes("pescatarian"))).toHaveLength(8);
  });
});

describe("the food tables are consistent", () => {
  it("150 foods, each with sane per-gram macros (or per-unit for an egg, a slice, a wrap, a cake, a bagel)", () => {
    expect(Object.keys(FOOD_DENSITY)).toHaveLength(150);
    for (const [key, d] of Object.entries(FOOD_DENSITY)) {
      for (const n of [d.protein, d.carbs, d.fat]) expect(n, key).toBeGreaterThanOrEqual(0);
      if (!PER_UNIT_KEYS.has(key)) expect(d.protein + d.carbs + d.fat, `${key} cannot weigh more than itself`).toBeLessThanOrEqual(1.001);
    }
    for (const k of PER_UNIT_KEYS) expect(FOOD_DENSITY, k).toHaveProperty(k);
  });
  it("every diet-table and name-table key is a real food", () => {
    for (const k of Object.keys(FOOD_ARCHETYPES)) expect(FOOD_DENSITY, k).toHaveProperty(k);
    for (const [name, k] of [...Object.entries(NAME_TO_KEY), ...Object.entries(EXTRA_NAME_TO_KEY)]) expect(FOOD_DENSITY, `${name} -> ${k}`).toHaveProperty(k);
  });
});

describe("every recipe builds at every target: known foods only, real numbers, nothing negative", () => {
  it("no recipe throws, returns NaN or an unknown food, at the old app's extreme targets or across the whole grid", () => {
    for (const r of RECIPES) {
      const targets = [
        ...OLD_MACRO_SETS.map((m) => ({ proteinG: m.p, carbsG: m.c, fatG: m.f })),
        ...familiesOf(r.archetypes).flatMap((fam) => gridFor(fam, r.slot)),
      ];
      for (const t of targets) {
        const items = r.build(t.proteinG, t.carbsG, t.fatG);
        expect(Array.isArray(items), r.id).toBe(true);
        for (const item of items) {
          expect(typeof item.text, r.id).toBe("string");
          if (isIngredient(item)) {
            expect(Number.isFinite(item.qty), `${r.id} ${item.name} qty`).toBe(true);
            expect(foodKeyOf(item.name), `${r.id}: ${item.name} must be a known food`).not.toBeNull();
          }
        }
        const { macros, unknown } = mealMacros(items);
        expect(unknown, r.id).toEqual([]);
        expect(Number.isFinite(macros.calories), r.id).toBe(true);
      }
    }
  });
  it("a scaled meal never has a negative or empty line, and its macros are the sum of ALL its shown lines", () => {
    for (const r of ENABLED_TEMPLATES) {
      for (const fam of familiesOf(r.archetypes)) {
        for (const t of gridFor(fam, r.slot)) {
          const meal = scaleTemplate(r, t);
          if (!meal) continue;
          let p = 0;
          let c = 0;
          let f = 0;
          for (const i of meal.ingredients) {
            expect(i.qty, `${r.id} ${i.name}`).toBeGreaterThanOrEqual(0);
            expect(i.text.trim(), `${r.id} ${i.name}`).not.toBe("");
            const m = ingredientMacros(i);
            expect(m, i.name).not.toBeNull();
            p += m!.proteinG;
            c += m!.carbsG;
            f += m!.fatG;
          }
          expect(meal.macros.proteinG).toBeCloseTo(p, 6);
          expect(meal.macros.carbsG).toBeCloseTo(c, 6);
          expect(meal.macros.fatG).toBeCloseTo(f, 6);
          expect(checkTolerance(meal.macros, t).ok, `${r.id} ${JSON.stringify(t)}`).toBe(true);
        }
      }
    }
  });
});

describe("what lands inside the tolerance (calories and protein 10 percent, protein never under 90 percent, carbs and fat 15 percent)", () => {
  it("every enabled recipe lands on at least half of the six target sizes in its best shape; a disabled one lands on none, with a written reason", () => {
    for (const r of RECIPES) {
      if (r.id in DISABLED_TEMPLATES) {
        expect(bestPasses(r), `${r.id} is disabled, so it must really land nowhere`).toBe(0);
        expect(DISABLED_TEMPLATES[r.id].length, r.id).toBeGreaterThan(40);
      } else {
        expect(bestPasses(r), `${r.id} lands on too few targets: fix it or disable it with a reason`).toBeGreaterThanOrEqual(3);
      }
    }
    for (const id of Object.keys(DISABLED_TEMPLATES)) expect(RECIPES.some((r) => r.id === id), id).toBe(true);
  });
  it("a fixed side can no longer hide: the string cheese snack counts its sticks as sticks", () => {
    const r = RECIPES.find((x) => x.id === "s_string_cheese_jerky_apple")!;
    for (const t of gridFor("standard", "snack")) {
      const meal = scaleTemplate(r, t);
      expect(meal, JSON.stringify(t)).not.toBeNull();
      expect(meal!.macros.proteinG).toBeGreaterThanOrEqual(0.9 * t.proteinG);
      expect(meal!.macros.proteinG).toBeLessThanOrEqual(1.1 * t.proteinG);
    }
  });
});

// Combinations (diet, slot, target shape, size) where NO enabled recipe lands. These are real gaps in the starter library, listed so they are known and reviewed; the
// builder fills such a slot with the coach's own recipes or offers the AI top-up. The list must match exactly: a new recipe that closes a gap, or a change that opens
// one, fails this test until the list is updated on purpose.
const KNOWN_GAPS = [
  "keto|breakfast|keto|1.6",
  "keto|breakfast|keto|2",
  "keto|snack|keto|1.25",
  "keto|snack|keto|1.6",
  "keto|snack|keto|2",
  "pescatarian|breakfast|standard|0.6",
  "pescatarian|breakfast|standard|0.8",
  "pescatarian|breakfast|standard|1",
  "pescatarian|breakfast|standard|1.25",
  "pescatarian|breakfast|standard|1.6",
  "pescatarian|breakfast|standard|2",
  "pescatarian|breakfast|high_carb|0.6",
  "pescatarian|breakfast|high_carb|0.8",
  "pescatarian|breakfast|high_carb|1",
  "pescatarian|breakfast|high_carb|1.25",
  "pescatarian|breakfast|high_carb|1.6",
  "pescatarian|breakfast|high_carb|2",
  "pescatarian|snack|low_carb|0.6",
  "pescatarian|snack|low_carb|0.8",
  "pescatarian|snack|low_carb|1",
  "pescatarian|snack|low_carb|1.25",
  "pescatarian|snack|low_carb|1.6",
  "pescatarian|snack|high_carb|0.6",
  "pescatarian|snack|high_carb|1",
  "pescatarian|snack|high_carb|1.6",
  "pescatarian|snack|high_carb|2",
  "carnivore|snack|carnivore|0.6",
  "carnivore|snack|carnivore|0.8",
  "carnivore|snack|carnivore|1",
  "carnivore|snack|carnivore|1.25",
  "carnivore|snack|carnivore|1.6",
  "carnivore|snack|carnivore|2",
];

describe("coverage: which diets and slots the starter library can fill", () => {
  it("the gaps are exactly the known ones", () => {
    const gaps: string[] = [];
    for (const d of DIET_TYPES) {
      for (const slot of SLOTS) {
        for (const fam of familiesOfDiet(d)) {
          SCALES.forEach((s, i) => {
            const t = gridFor(fam, slot)[i];
            const n = templatesFor(slot, d).filter((r) => scaleTemplate(r, t) !== null).length;
            if (n === 0) gaps.push(`${d}|${slot}|${fam}|${s}`);
          });
        }
      }
    }
    expect(gaps).toEqual(KNOWN_GAPS);
  });
  it("an everyday omnivore always has at least three meals in every slot at every size", () => {
    for (const slot of SLOTS) {
      for (const fam of familiesOfDiet("omnivore")) {
        gridFor(fam, slot).forEach((t) => {
          expect(templatesFor(slot, "omnivore").filter((r) => scaleTemplate(r, t) !== null).length, `${slot} ${fam} ${JSON.stringify(t)}`).toBeGreaterThanOrEqual(3);
        });
      }
    }
  });
});

describe("tags: allergens and diets are worked out from what is in the recipe", () => {
  it("every recipe fits every diet it declares (vegan has no animal food, vegetarian no meat or fish, pescatarian no meat, and the old food-by-diet table agrees)", () => {
    for (const r of RECIPES) for (const d of r.archetypes) expect(dietProblems(r, d), `${r.id} as ${d}`).toEqual([]);
  });
  it("allergen tags follow the ingredients", () => {
    const tags = (id: string) => templateAllergens(RECIPES.find((r) => r.id === id)!);
    expect(tags("b_power_oats")).toEqual(expect.arrayContaining(["peanut", "dairy"]));
    expect(tags("l_chicken_rice_broccoli")).toEqual([]);
    expect(tags("b_salmon_toast_pescatarian")).toEqual(expect.arrayContaining(["fish", "wheat or gluten"]));
    expect(tags("d_chicken_pineapple_broccoli")).toEqual(expect.arrayContaining(["soy"]));
    expect(tags("b_tofu_scramble_berries_vegan")).toContain("soy");
  });
  it("a vegan recipe is never tagged with dairy, egg, fish or shellfish; a pescatarian one never with meat-only logic breaking", () => {
    for (const r of RECIPES.filter((x) => x.archetypes.includes("vegan"))) {
      const t = templateAllergens(r);
      for (const banned of ["dairy", "egg", "fish", "shellfish"] as const) expect(t, `${r.id} ${banned}`).not.toContain(banned);
    }
    for (const t of RECIPES.map((r) => templateAllergens(r))) for (const a of t) expect(ALLERGEN_KEYS).toContain(a);
  });
});

describe("rendering", () => {
  it("keeps the lines the recipe wrote and leaves out the blank ones", () => {
    const r = RECIPES.find((x) => x.id === "b_ny_strip_eggs_cor")!;
    const meal = scaleTemplate(r, { proteinG: 40, carbsG: 60, fatG: 15 })!;
    const lines = renderLines(meal.items);
    expect(lines.length).toBeGreaterThan(3);
    expect(lines[0]).toContain("<strong>Preparation:</strong>");
    expect(lines.every((l) => l.trim() !== "")).toBe(true);
    expect(lines.some((l) => l.includes("NY Strip") && l.includes("oz)"))).toBe(true);
  });
  it("a metric client sees no ounce hints", () => {
    expect(toOz(283.495)).toBe("(~10.0 oz)");
    expect(stripOunceHints("<strong>NY Strip (Raw):</strong> 180g (~6.3 oz)")).toBe("<strong>NY Strip (Raw):</strong> 180g");
    const r = RECIPES.find((x) => x.id === "b_ny_strip_eggs_cor")!;
    const lines = renderLines(scaleTemplate(r, { proteinG: 40, carbsG: 60, fatG: 15 })!.items, { metric: true });
    expect(lines.some((l) => l.includes("oz)"))).toBe(false);
  });
  it("a line too small to show is not part of the meal, and its macros are not counted", () => {
    const fake: TemplateRecipe = {
      id: "fake",
      name: "Fake",
      slot: "snack",
      archetypes: ["omnivore"],
      keywords: ["fake"],
      build: () => [
        { text: "Prep" },
        { name: "Hass Avocado", category: "fats", qty: 400, unit: "g", text: "" },
        { name: "Chicken Breast", category: "proteins", qty: 100, unit: "g", text: "<strong>Chicken:</strong> 100g" },
      ],
    };
    const { macros } = mealMacros(fake.build(0, 0, 0));
    expect(macros.proteinG).toBeCloseTo(23, 6);
    expect(macros.fatG).toBeCloseTo(2.5, 6);
    expect(mealIngredients(fake.build(0, 0, 0))).toHaveLength(1);
  });
});

describe("the scaler", () => {
  it("lands a formula that overshoots through its fixed sides (the old NY strip breakfast at 40/60/15 raw is 49 g protein and 26 g fat)", () => {
    const r = RECIPES.find((x) => x.id === "b_ny_strip_eggs_cor")!;
    const raw = mealMacros(r.build(40, 60, 15)).macros;
    expect(checkTolerance(raw, { proteinG: 40, carbsG: 60, fatG: 15 }).ok).toBe(false);
    const meal = scaleTemplate(r, { proteinG: 40, carbsG: 60, fatG: 15 });
    expect(meal === null || meal.passes > 1).toBe(true);
  });
  it("returns null, never a bad meal, when a recipe cannot land", () => {
    const r = RECIPES.find((x) => x.id === "s_jerky_eggs_carnivore")!;
    expect(scaleTemplate(r, { proteinG: 25, carbsG: 0, fatG: 25 })).toBeNull();
  });
  it("a formula that throws is skipped, not shown", () => {
    const bad: TemplateRecipe = { id: "bad", name: "Bad", slot: "lunch", archetypes: ["omnivore"], keywords: ["bad"], build: () => { throw new Error("boom"); } };
    expect(scaleTemplate(bad, { proteinG: 40, carbsG: 50, fatG: 15 })).toBeNull();
  });
  it("a recipe with a food nobody knows is skipped, not shown", () => {
    const odd: TemplateRecipe = {
      id: "odd",
      name: "Odd",
      slot: "lunch",
      archetypes: ["omnivore"],
      keywords: ["odd"],
      build: () => [{ name: "Mystery Paste", category: "proteins", qty: 100, unit: "g", text: "<strong>Mystery:</strong> 100g" }],
    };
    expect(scaleTemplate(odd, { proteinG: 40, carbsG: 50, fatG: 15 })).toBeNull();
  });
  it("the same target always gives the same meal", () => {
    const r = RECIPES.find((x) => x.id === "l_chicken_rice_broccoli")!;
    const t = { proteinG: 50, carbsG: 70, fatG: 18 };
    expect(JSON.stringify(scaleTemplate(r, t))).toBe(JSON.stringify(scaleTemplate(r, t)));
  });
});
