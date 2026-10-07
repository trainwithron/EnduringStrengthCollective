import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { ALLERGEN_KEYS, allergenWordsIn } from "@/lib/allergen-check";
import { DIET_TYPES as PREFERENCE_DIET_TYPES } from "@/lib/nutrition-preferences";
import { BREAD_LINE_WORDS, BREAD_VERB_WORDS, DECLARED_PREP_FOODS } from "./declared-prep";
import { DISABLED_TEMPLATES } from "./disabled";
import { ENABLED_TEMPLATES, RECIPES, templatesFor } from "./index";
import { FOOD_DENSITY, PER_UNIT_KEYS, UNIT_WEIGHT_G } from "./food-table";
import { EXTRA_NAME_TO_KEY, FOOD_ARCHETYPES, NAME_TO_KEY } from "./food-names";
import { FAMILIES, familiesOf, familiesOfDiet, gridFor, SCALES } from "./grid";
import { foodKeyOf, ingredientMacros, mealIngredients, mealMacros } from "./macros";
import { renderLines, stripOunceHints, toOz } from "./render";
import { MAX_DRIFT, scaleTemplate } from "./scale";
import { dietProblems, preparationText, templateAllergens } from "./tags";
import { absAllowanceG, carbFatAllowanceG, checkDayTolerance, checkTolerance } from "./tolerance";
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
  it("a per-unit food cannot have more macros than the unit weighs (no exceptions: the rice cake was corrected to USDA)", () => {
    // Unit weights: the table's own UNIT_WEIGHT_G, plus a plain bagel (about 100 g) and the three bread kinds (a slice).
    const unitG: Record<string, number> = {
      egg_whole_large: UNIT_WEIGHT_G.large,
      sourdough_slice: UNIT_WEIGHT_G.slices,
      whole_wheat_bread: UNIT_WEIGHT_G.slices,
      white_bread_slice: UNIT_WEIGHT_G.slices,
      bagel_plain: 100,
      whole_wheat_wrap: UNIT_WEIGHT_G.wraps,
      rice_cake: UNIT_WEIGHT_G.cakes,
    };
    const impossible: string[] = [];
    for (const k of PER_UNIT_KEYS) {
      const d = (FOOD_DENSITY as Record<string, { protein: number; carbs: number; fat: number }>)[k];
      expect(unitG[k], `${k} needs a unit weight`).toBeGreaterThan(0);
      if (d.protein + d.carbs + d.fat > unitG[k]) impossible.push(k);
    }
    expect(impossible).toEqual([]);
  });
  it("the numbers are physically sane: no food gives more than 9.1 kcal a gram, a leaner grade never has more fat than a fattier one, and related foods keep their order", () => {
    const d = FOOD_DENSITY as unknown as Record<string, { protein: number; carbs: number; fat: number }>;
    const unitG: Record<string, number> = { egg_whole_large: 50, sourdough_slice: 40, whole_wheat_bread: 28, white_bread_slice: 25, bagel_plain: 100, whole_wheat_wrap: 50, rice_cake: 9 };
    for (const [k, v] of Object.entries(d)) {
      const kcal = 4 * v.protein + 4 * v.carbs + 9 * v.fat;
      expect(kcal, `${k} kcal`).toBeGreaterThanOrEqual(0);
      expect(kcal / (PER_UNIT_KEYS.has(k) ? unitG[k] : 1), `${k} kcal per gram`).toBeLessThanOrEqual(9.1);
    }
    // Ground beef: the leaner the grade, the less fat.
    const fatOf = (k: string) => d[k].fat;
    const beef = ["ground_beef_80_20", "ground_beef_85_15", "ground_beef_90_10", "ground_beef_93_7", "ground_beef_96_4"];
    for (let i = 1; i < beef.length; i++) expect(fatOf(beef[i]), `${beef[i]} must not have more fat than ${beef[i - 1]}`).toBeLessThanOrEqual(fatOf(beef[i - 1]));
    // Milk: skim, then 2 percent, then whole. Ground turkey: fat free, then 93/7.
    expect(fatOf("milk_skim")).toBeLessThanOrEqual(fatOf("milk_2_pct"));
    expect(fatOf("milk_2_pct")).toBeLessThanOrEqual(fatOf("milk_whole"));
    expect(fatOf("ground_turkey_99_1")).toBeLessThanOrEqual(fatOf("ground_turkey_93_7"));
    // Cuts of chicken: breast, then thigh, then the wing with its skin. Fish: white fish is leaner than salmon.
    expect(fatOf("chicken_breast")).toBeLessThanOrEqual(fatOf("chicken_thigh"));
    expect(fatOf("chicken_thigh")).toBeLessThanOrEqual(fatOf("chicken_wing"));
    expect(fatOf("white_fish")).toBeLessThan(fatOf("salmon_raw"));
    // Oils are pure fat; a protein powder is mostly protein.
    for (const k of ["olive_oil_g", "sesame_oil_g"]) expect(fatOf(k)).toBe(1);
    expect(d.whey_isolate.protein).toBeGreaterThan(0.8);
  });
  it("a chicken thigh line always says skinless (the USDA record is meat only), and the 95/5 beef row is the only ground beef row nothing prints", () => {
    const thighRecipes = RECIPES.filter((r) => r.build(40, 40, 15).some((i) => isIngredient(i) && i.name === "Chicken Thigh"));
    expect(thighRecipes.length).toBeGreaterThan(0);
    for (const r of thighRecipes) {
      const line = r.build(40, 40, 15).filter(isIngredient).find((i) => i.name === "Chicken Thigh")!;
      expect(line.text, r.id).toContain("Skinless");
    }
    const source = readFileSync(new URL("./recipes.ts", import.meta.url), "utf8");
    expect(source).not.toContain("ground_beef_96_4");
    expect(source).not.toContain("Chicken Thigh (Raw)");
  });
  it("every row carries its USDA record, except the exact list that has none (supplements, branded cereals, edamame, mixed berries, seitan, the plant blend)", () => {
    const source = readFileSync(new URL("./food-table.ts", import.meta.url), "utf8");
    const rows = [...source.matchAll(/^\s+([a-z0-9_]+):\s*\{[^}]*\},?(.*)$/gm)].filter((m) => m[1] in FOOD_DENSITY);
    expect(rows).toHaveLength(150);
    const without = rows.filter((m) => !/\/\/ USDA fdc \d+ \(was /.test(m[2])).map((m) => m[1]);
    expect(without.sort()).toEqual(
      ["berries_mixed", "brown_rice_pasta", "casein_protein", "corn_flakes", "cottage_cheese_2pct", "edamame", "milk_2_pct", "milk_skim", "pea_protein", "plant_protein", "rice_krispies", "seitan", "shredded_wheat", "tvp_dry", "whey_isolate"].sort()
    );
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

// How many of the six target sizes a recipe lands on, in the best target shape of ONE diet it declares.
function bestPassesForDiet(r: TemplateRecipe, diet: (typeof DIET_TYPES)[number]): number {
  return Math.max(...familiesOfDiet(diet).map((fam) => gridFor(fam, r.slot).filter((t) => scaleTemplate(r, t) !== null).length));
}

// (recipe | declared diet | best number of sizes) where an enabled recipe lands on FEWER than three of the six sizes for a diet it declares. These are real narrow spots,
// listed so they are known and reviewed. The list must match exactly: a fix that widens one, or a change that narrows another, fails until the list is updated on purpose.
// The NY strip breakfast lands on the low-carb shape (its fat now matches its protein, so it no longer fits the standard shape).
const NY_TARGET = gridFor("low_carb", "breakfast")[2];

const KNOWN_NARROW = [
  "l_ground_beef_cabbage_bowl_keto|omnivore|0",
  "d_ribeye_potatoes|omnivore|0",
  "d_ribeye_potatoes|paleo|0",
  "d_flank_steak_butter_carnivore|keto|2",
  "d_chuck_roast_mash|omnivore|0",
  "d_chuck_roast_mash|paleo|0",
  "d_ribeye_sweet_potato_steakhouse|omnivore|0",
  "d_ribeye_sweet_potato_steakhouse|paleo|0",
];

describe("what lands inside the tolerance (calories and protein 10 percent, protein never under 90 percent, carbs and fat 15 percent or a small allowance)", () => {
  it("every enabled recipe lands somewhere for at least one diet it declares; a disabled one lands on none, with a written reason", () => {
    for (const r of RECIPES) {
      if (r.id in DISABLED_TEMPLATES) {
        for (const d of r.archetypes) expect(bestPassesForDiet(r, d), `${r.id} is disabled, so it must really land nowhere (${d})`).toBe(0);
        expect(bestPasses(r), r.id).toBe(0);
        expect(DISABLED_TEMPLATES[r.id].length, r.id).toBeGreaterThan(40);
      } else {
        const best = Math.max(...r.archetypes.map((d) => bestPassesForDiet(r, d)));
        expect(best, `${r.id} lands nowhere in any diet it declares: fix it or disable it with a reason`).toBeGreaterThanOrEqual(1);
      }
    }
    for (const id of Object.keys(DISABLED_TEMPLATES)) expect(RECIPES.some((r) => r.id === id), id).toBe(true);
  });
  it("the narrow spots are exactly the known ones (an enabled recipe landing on fewer than three sizes for a diet it declares)", () => {
    const narrow: string[] = [];
    for (const r of RECIPES) {
      if (r.id in DISABLED_TEMPLATES) continue;
      for (const d of r.archetypes) {
        const best = bestPassesForDiet(r, d);
        if (best < 3) narrow.push(`${r.id}|${d}|${best}`);
      }
    }
    expect(narrow).toEqual(KNOWN_NARROW);
  });
  it("the carb and fat allowance stays proportional to a small target (a 4 g keto carb target never shows 9 g)", () => {
    expect(absAllowanceG(6)).toBeCloseTo(2.4, 6);
    expect(absAllowanceG(12)).toBeCloseTo(4.8, 6);
    expect(absAllowanceG(4)).toBe(2);
    expect(absAllowanceG(0)).toBe(2);
    expect(absAllowanceG(100)).toBe(5);
    expect(carbFatAllowanceG(4)).toBe(2);
    expect(carbFatAllowanceG(100)).toBe(15);
    expect(carbFatAllowanceG(60)).toBe(9);
    const target = { proteinG: 30, carbsG: 4, fatG: 30 };
    const meal = { calories: 4 * 30 + 4 * 9 + 9 * 30, proteinG: 30, carbsG: 9, fatG: 30 };
    expect(checkTolerance(meal, target).misses).toContain("carbs");
    expect(checkTolerance({ ...meal, carbsG: 6, calories: 4 * 30 + 4 * 6 + 9 * 30 }, target).misses).not.toContain("carbs");
  });
  it("on a low-carb target, fewer carbs than the target is never a miss; on a normal target both sides count", () => {
    const low = { proteinG: 30, carbsG: 6, fatG: 30 };
    const zero = { calories: 4 * 30 + 9 * 30, proteinG: 30, carbsG: 0, fatG: 30 };
    expect(checkTolerance(zero, low).ok).toBe(true);
    const normal = { proteinG: 30, carbsG: 60, fatG: 20 };
    const under = { calories: 4 * 30 + 4 * 40 + 9 * 20, proteinG: 30, carbsG: 40, fatG: 20 };
    expect(checkTolerance(under, normal).misses).toContain("carbs");
  });
  it("the whole day is checked on its own, so small overshoots in every meal cannot add up on a keto plan", () => {
    const day = { proteinG: 160, carbsG: 25, fatG: 130 };
    const meal = (c: number) => ({ calories: 0, proteinG: 40, carbsG: c, fatG: 32.5 });
    expect(checkDayTolerance([meal(6), meal(6), meal(6), meal(6)], day).ok).toBe(true);
    expect(checkDayTolerance([meal(12), meal(12), meal(12), meal(12)], day).misses).toContain("carbs");
    expect(checkDayTolerance([meal(0), meal(0), meal(0), meal(0)], day).ok).toBe(true);
  });
  it("a meal whose formula had to be aimed very far from the slot's own target is skipped (the drift cap)", () => {
    for (const r of ENABLED_TEMPLATES) {
      for (const fam of familiesOf(r.archetypes)) {
        for (const t of gridFor(fam, r.slot)) {
          const meal = scaleTemplate(r, t);
          if (meal) expect(meal.drift, `${r.id} ${JSON.stringify(t)}`).toBeLessThanOrEqual(MAX_DRIFT);
        }
      }
    }
  });
  it("the high-protein and light target shapes exist, with more and less protein than the standard shape", () => {
    expect(FAMILIES).toEqual(expect.arrayContaining(["standard", "low_carb", "high_carb", "high_protein", "light", "keto", "carnivore"]));
    for (const slot of SLOTS) {
      const std = gridFor("standard", slot)[2];
      expect(gridFor("high_protein", slot)[2].proteinG, slot).toBeGreaterThan(std.proteinG);
      expect(gridFor("light", slot)[2].proteinG, slot).toBeLessThan(std.proteinG * 1.2);
      expect(gridFor("light", slot)[2].fatG + gridFor("light", slot)[2].carbsG, slot).toBeLessThanOrEqual(std.fatG + std.carbsG + 10);
    }
  });
  it("string cheese is counted as sticks, not grams: a stick is 24 g, whatever the snack is switched on or off", () => {
    const r = RECIPES.find((x) => x.id === "s_string_cheese_jerky_apple")!;
    const items = r.build(15, 15, 5);
    const cheese = items.filter(isIngredient).find((i) => i.name === "String Cheese")!;
    expect(cheese.unit).toBe("pieces");
    const m = ingredientMacros(cheese)!;
    expect(m.proteinG).toBeCloseTo(cheese.qty * UNIT_WEIGHT_G.pieces * FOOD_DENSITY.string_cheese.protein, 6);
    expect(m.proteinG).toBeGreaterThan(0);
  });
});

// Combinations (diet, slot, target shape, size) where NO enabled recipe lands. These are real gaps in the starter library, listed so they are known and reviewed; the
// builder fills such a slot with the coach's own recipes or offers the AI top-up. The list must match exactly: a new recipe that closes a gap, or a change that opens
// one, fails this test until the list is updated on purpose.
const KNOWN_GAPS = [
  "vegan|breakfast|high_protein|0.6",
  "vegan|breakfast|high_protein|0.8",
  "vegan|breakfast|high_protein|1",
  "vegan|breakfast|high_protein|1.25",
  "vegan|breakfast|high_protein|1.6",
  "vegan|breakfast|high_protein|2",
  "vegan|snack|high_protein|0.6",
  "keto|snack|keto|0.6",
  "keto|snack|keto|0.8",
  "keto|snack|keto|1",
  "keto|snack|keto|1.25",
  "keto|snack|keto|1.6",
  "keto|snack|keto|2",
  "paleo|snack|standard|1",
  "paleo|snack|standard|1.25",
  "paleo|snack|standard|1.6",
  "paleo|snack|standard|2",
  "paleo|snack|high_carb|0.6",
  "paleo|snack|high_carb|0.8",
  "paleo|snack|high_carb|1",
  "paleo|snack|high_carb|1.25",
  "paleo|snack|high_carb|1.6",
  "paleo|snack|high_carb|2",
  "paleo|snack|high_protein|0.6",
  "paleo|snack|high_protein|0.8",
  "paleo|snack|high_protein|2",
  "paleo|snack|light|0.6",
  "paleo|snack|light|0.8",
  "paleo|snack|light|1.6",
  "paleo|snack|light|2",
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
  "pescatarian|breakfast|high_protein|0.6",
  "pescatarian|breakfast|high_protein|0.8",
  "pescatarian|breakfast|high_protein|1",
  "pescatarian|breakfast|high_protein|1.25",
  "pescatarian|breakfast|high_protein|1.6",
  "pescatarian|breakfast|high_protein|2",
  "pescatarian|breakfast|light|0.6",
  "pescatarian|breakfast|light|0.8",
  "pescatarian|breakfast|light|1",
  "pescatarian|breakfast|light|1.25",
  "pescatarian|breakfast|light|1.6",
  "pescatarian|breakfast|light|2",
  "pescatarian|snack|standard|1.6",
  "pescatarian|snack|standard|2",
  "pescatarian|snack|low_carb|0.6",
  "pescatarian|snack|low_carb|1",
  "pescatarian|snack|low_carb|1.6",
  "pescatarian|snack|high_carb|1",
  "pescatarian|snack|high_carb|1.25",
  "pescatarian|snack|high_carb|1.6",
  "pescatarian|snack|high_carb|2",
  "pescatarian|snack|high_protein|0.8",
  "pescatarian|snack|light|0.8",
  "carnivore|snack|carnivore|0.6",
  "carnivore|snack|carnivore|0.8",
  "carnivore|snack|carnivore|1",
  "carnivore|snack|carnivore|1.25",
  "carnivore|snack|carnivore|1.6",
  "carnivore|snack|carnivore|2",
];

// (slot | shape | size | meals) where an everyday omnivore has fewer than three meals (two on the high-protein and light shapes). All are snacks: the jerky snacks no longer land
// with USDA-accurate jerky.
const KNOWN_OMNIVORE_THIN = [
  "snack|standard|1.6|2",
  "snack|standard|2|2",
  "snack|low_carb|1|2",
  "snack|low_carb|1.6|2",
  "snack|high_carb|1|2",
  "snack|high_carb|1.25|2",
  "snack|high_carb|1.6|1",
  "snack|high_carb|2|1",
  "snack|high_protein|0.8|1",
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
  it("an everyday omnivore has at least three meals at every size of every slot except the exact thin spots listed (all snacks), and never fewer than one", () => {
    const thin: string[] = [];
    for (const slot of SLOTS) {
      for (const fam of familiesOfDiet("omnivore")) {
        gridFor(fam, slot).forEach((t, i) => {
          const n = templatesFor(slot, "omnivore").filter((r) => scaleTemplate(r, t) !== null).length;
          expect(n, `${slot} ${fam} ${SCALES[i]}`).toBeGreaterThanOrEqual(1);
          if (n < (fam === "high_protein" || fam === "light" ? 2 : 3)) thin.push(`${slot}|${fam}|${SCALES[i]}|${n}`);
        });
      }
    }
    expect(thin).toEqual(KNOWN_OMNIVORE_THIN);
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
  it("a food named only in the preparation text is seen by the checks: the teriyaki chicken is soy and wheat or gluten", () => {
    const r = RECIPES.find((x) => x.id === "d_chicken_pineapple_broccoli")!;
    expect(preparationText(r)).toMatch(/teriyaki/i);
    expect(allergenWordsIn("sugar-free teriyaki sauce", "wheat or gluten")).toContain("teriyaki");
    expect(templateAllergens(r)).toEqual(expect.arrayContaining(["soy", "wheat or gluten"]));
  });
  it("the cereal bowl counts its milk: it has a milk line and is tagged dairy", () => {
    const r = RECIPES.find((x) => x.id === "b_cereal_bowl_eggs")!;
    const meal = scaleTemplate(r, gridFor("standard", "breakfast")[2])!;
    expect(meal).not.toBeNull();
    expect(meal.ingredients.some((i) => /milk/i.test(i.name))).toBe(true);
    expect(templateAllergens(r)).toContain("dairy");
  });
  it("every food the preparation text names is a counted line or is declared (with the reason), and every declaration is still true", () => {
    const SEASONINGS = ["teriyaki", "garlic", "lime", "lemon", "onion", "vinegar", "broth", "vanilla", "turmeric", "nutritional yeast", "cinnamon", "paprika", "pepper", "chili", "salt", "mint", "water", "hoisin", "soy sauce"];
    for (const r of RECIPES) {
      const prep = [...new Set(FAMILIES.map((fam) => preparationText(r, fam === "keto" ? "keto" : fam === "carnivore" ? "carnivore" : "omnivore")))].join(" ").toLowerCase();
      const names = new Set<string>();
      for (const fam of FAMILIES) {
        for (const t of gridFor(fam, r.slot)) for (const i of r.build(t.proteinG, t.carbsG, t.fatG)) if (isIngredient(i)) names.add(i.name.toLowerCase());
      }
      const lines = [...names].join(" | ");
      const found = new Set<string>(SEASONINGS.filter((t) => new RegExp(`\\b${t}\\b`).test(prep)));
      for (const k of ALLERGEN_KEYS) for (const w of allergenWordsIn(prep, k)) found.add(w);
      const declared = DECLARED_PREP_FOODS[r.id]?.foods ?? [];
      const undeclared = [...found].filter((w) => {
        if (lines.includes(w) || lines.includes(w.replace(/s$/, "")) || lines.includes(w.replace(/ies$/, "y"))) return false;
        if (BREAD_VERB_WORDS.includes(w) && BREAD_LINE_WORDS.some((b) => lines.includes(b))) return false;
        return !declared.some((d) => d.includes(w) || w.includes(d));
      });
      expect(undeclared, `${r.id}: foods named in the preparation text that are not a line and not declared`).toEqual([]);
      for (const d of declared) expect(prep, `${r.id}: declared food "${d}" is no longer in the preparation text`).toContain(d);
    }
    for (const id of Object.keys(DECLARED_PREP_FOODS)) {
      expect(RECIPES.some((r) => r.id === id), `${id} is declared but is not a recipe`).toBe(true);
      expect(DECLARED_PREP_FOODS[id].reason.length, id).toBeGreaterThan(5);
    }
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
    const meal = scaleTemplate(r, NY_TARGET)!;
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
    const lines = renderLines(scaleTemplate(r, NY_TARGET)!.items, { metric: true });
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
    expect(macros.proteinG).toBeCloseTo(100 * FOOD_DENSITY.chicken_breast.protein, 6);
    expect(macros.fatG).toBeCloseTo(100 * FOOD_DENSITY.chicken_breast.fat, 6);
    expect(mealIngredients(fake.build(0, 0, 0))).toHaveLength(1);
  });
});

describe("the scaler", () => {
  it("lands a formula that overshoots through its fixed sides (the old NY strip breakfast, built raw at the slot target, misses it; the scaler re-aims it onto the target)", () => {
    const r = RECIPES.find((x) => x.id === "b_ny_strip_eggs_cor")!;
    const raw = mealMacros(r.build(NY_TARGET.proteinG, NY_TARGET.carbsG, NY_TARGET.fatG)).macros;
    expect(checkTolerance(raw, NY_TARGET).ok).toBe(false);
    const meal = scaleTemplate(r, NY_TARGET);
    expect(meal).not.toBeNull();
    expect(meal!.passes).toBeGreaterThan(1);
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
