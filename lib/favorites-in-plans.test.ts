import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { scaledCandidates, selectOptions, type SelectionContext } from "@/lib/library-selection";
import { gridFor } from "@/lib/meal-templates/grid";
import { checkTolerance, type SlotTarget } from "@/lib/meal-templates/tolerance";
import { caloriesOf } from "@/lib/meal-templates/macros";
import { MAX_STARS_PER_SLOT, portionFactor, portionLabel, portionStarMeal, portionStarSlots } from "@/lib/starred-in-plans";
import { scaleStarForMeal } from "@/lib/star-to-plan";
import { addStarredToPlan, starFromChoice, starFromLogged, type StarredMeal } from "@/lib/starred-meals";
import { choiceFromOption, optionFromScaled } from "@/lib/library-meal-plan";
import type { MealPlanRow } from "@/lib/meal-plan-assignment";
import type { LibraryRecipe } from "@/lib/library-scaling";
import { loadCoachRecipe } from "@/lib/library-data";
import { ENABLED_TEMPLATES } from "@/lib/meal-templates";
import { scaleTemplate } from "@/lib/meal-templates/scale";
import type { DietType } from "@/lib/meal-templates/types";
import { fromTemplateMeal } from "@/lib/scaled-meal";

// Ron, Nov 21 (approved): the coach's starred meals feed every new plan, first, scaled to each client; a star with no amounts goes in as whole portions; the plan marks them.
const read = (p: string) => readFileSync(join(__dirname, "..", p), "utf8").replace(/\r\n/g, "\n");

const ctxOf = (over: Partial<SelectionContext> = {}): SelectionContext => ({
  rules: {},
  diet: "omnivore",
  likes: [],
  favorites: { ids: new Set(), names: new Set() },
  recentlyOffered: new Map(),
  mixItUp: false,
  recentDays: 7,
  coachRecipes: [],
  ...over,
});

const lunch = gridFor("standard", "lunch")[2];
// A starred library meal: the coach starred an option the builder offered (its key is the template's, "t:<id>").
function starOfCandidate(index: number, target: SlotTarget = lunch): StarredMeal {
  const all = scaledCandidates("lunch", target, ctxOf());
  const star = starFromChoice(choiceFromOption(optionFromScaled(all[index])));
  if (!star) throw new Error("no star");
  return star;
}
const logged = (name: string, kcal: number, p: number, c: number, f: number) => starFromLogged({ description: name, calories: kcal, proteinG: p, carbsG: c, fatG: f })!;

describe("stars come first", () => {
  it("a starred library meal leads the options for the meal it fits, scaled to this target", () => {
    const plain = selectOptions("lunch", lunch, ctxOf()).options.map((m) => m.key);
    // a meal that is NOT the builder's first pick on its own
    const all = scaledCandidates("lunch", lunch, ctxOf());
    const index = all.findIndex((m) => m.key !== plain[0] && checkTolerance(m.macros, lunch).ok);
    const star = starOfCandidate(index);
    const sel = selectOptions("lunch", lunch, ctxOf({ starred: [star] }));
    expect(sel.options[0].key).toBe(star.meal.key);
    expect(sel.options[0].coachStar).toBe(true);
    expect(checkTolerance(sel.options[0].macros, lunch).ok).toBe(true);
    // and the saved option says it came from the favorites
    expect(choiceFromOption(optionFromScaled(sel.options[0])).fromFavorite).toBe(true);
  });
  it("at most two of a meal's three options are stars, so the menu still changes", () => {
    const all = scaledCandidates("lunch", lunch, ctxOf()).filter((m) => checkTolerance(m.macros, lunch).ok);
    const stars = all.slice(0, 4).map((m) => starFromChoice(choiceFromOption(optionFromScaled(m)))!);
    const sel = selectOptions("lunch", lunch, ctxOf({ starred: stars }));
    expect(sel.options.filter((m) => m.coachStar).length).toBe(MAX_STARS_PER_SLOT);
    expect(sel.options.length).toBe(3);
  });
  it("two stars take turns: one offered lately moves below the other (and both stay above the library)", () => {
    const all = scaledCandidates("lunch", lunch, ctxOf()).filter((m) => checkTolerance(m.macros, lunch).ok);
    const [a, b] = [all[0], all[1]].map((m) => starFromChoice(choiceFromOption(optionFromScaled(m)))!);
    const first = selectOptions("lunch", lunch, ctxOf({ starred: [a, b], mixItUp: true, recentlyOffered: new Map([[a.meal.key!, 0]]) }));
    expect(first.options[0].key).toBe(b.meal.key);
    expect(first.options[1].key).toBe(a.meal.key);
  });
});

describe("a client's food rules still decide", () => {
  it("a starred logged meal never reaches a built plan: a 'Pad thai' is not offered to a peanut allergy (only its name could be checked), nor to anyone", () => {
    const padThai = logged("Pad thai", 640, 30, 80, 20);
    const target = { proteinG: 30, carbsG: 80, fatG: 20 };
    for (const rules of [{ allergies: ["peanut"] }, {}]) {
      for (const slot of ["lunch", "dinner"] as const) {
        expect(scaledCandidates(slot, target, ctxOf({ starred: [padThai], rules })).some((m) => m.name === "Pad thai" || m.key.startsWith("fav:"))).toBe(false);
        expect(selectOptions(slot, target, ctxOf({ starred: [padThai], rules })).options.some((m) => m.name === "Pad thai")).toBe(false);
      }
    }
  });
  it("no whole-portion star (logged, AI or a deleted recipe) is ever in a built plan, across a whole week", () => {
    const stars = [logged("Chipotle chicken bowl", 600, 45, 60, 20), { ...logged("Deleted recipe bowl", 600, 45, 60, 20), meal: { ...logged("Deleted recipe bowl", 600, 45, 60, 20).meal, key: "r:gone" } }, { ...logged("AI salmon plate", 620, 45, 50, 22), meal: { ...logged("AI salmon plate", 620, 45, 50, 22).meal, key: "ai:abc", source: "ai" as const } }];
    for (const slot of ["breakfast", "lunch", "dinner", "snack"] as const) {
      expect(scaledCandidates(slot, lunch, ctxOf({ starred: stars })).filter((m) => m.portion != null || m.key.startsWith("fav:"))).toEqual([]);
    }
    expect(read("lib/library-selection.ts")).not.toContain("portionStarMeal");
  });
  it("a keto lunch never gets a 90 g-carb star", () => {
    const all = scaledCandidates("lunch", { proteinG: 40, carbsG: 90, fatG: 15 }, ctxOf()).filter((m) => m.macros.carbsG >= 80);
    expect(all.length).toBeGreaterThan(0);
    const star = starFromChoice(choiceFromOption(optionFromScaled(all[0])))!;
    const keto = { proteinG: 40, carbsG: 10, fatG: 35 };
    const sel = selectOptions("lunch", keto, ctxOf({ diet: "keto", starred: [star] }));
    expect(sel.options.some((m) => m.key === star.meal.key)).toBe(false);
    expect(sel.options.every((m) => m.macros.carbsG < 30)).toBe(true);
  });
  it("a food the client dislikes keeps a starred library meal out", () => {
    const star = starOfCandidate(0);
    const disliked = star.meal.lines?.find((l) => l.category === "proteins")?.name ?? star.name;
    const sel = selectOptions("lunch", lunch, ctxOf({ starred: [star], rules: { dislikes: [disliked] } }));
    expect(sel.options.some((m) => m.key === star.meal.key)).toBe(false);
  });
});

describe("scaled to each client", () => {
  it("the same starred meal goes up for a bigger client and down for a smaller one, inside the builder's tolerance", () => {
    const star = starOfCandidate(0);
    const small = { proteinG: lunch.proteinG * 0.75, carbsG: lunch.carbsG * 0.75, fatG: lunch.fatG * 0.75 };
    const big = { proteinG: lunch.proteinG * 1.3, carbsG: lunch.carbsG * 1.3, fatG: lunch.fatG * 1.3 };
    const s = scaleStarForMeal(star, small)!;
    const b = scaleStarForMeal(star, big)!;
    expect(s.portion).toBeUndefined();
    expect(b.portion).toBeUndefined();
    expect(checkTolerance(s.macros, small).ok).toBe(true);
    expect(checkTolerance(b.macros, big).ok).toBe(true);
    const gramsOf = (m: typeof s) => m.lines.reduce((n, l) => n + (l.grams ?? 0), 0);
    expect(gramsOf(b)).toBeGreaterThan(gramsOf(s));
  });
});

describe("a star with no amounts goes in as whole portions, never with made-up ingredients", () => {
  it("quarters, from half to three, said plainly", () => {
    expect(portionFactor(600, 750)).toBe(1.25);
    expect(portionFactor(600, 600)).toBe(1);
    expect(portionFactor(800, 300)).toBe(0.5);
    expect(portionFactor(200, 1200)).toBe(3);
    expect(portionLabel(1.25)).toBe("1¼ servings");
    expect(portionLabel(1)).toBe("1 serving");
    expect(portionLabel(0.5)).toBe("½ serving");
    expect(portionLabel(2.5)).toBe("2½ servings");
  });
  it("fits the meals its name says (breakfast foods at breakfast, snacks as a snack, the rest at lunch and dinner)", () => {
    expect(portionStarSlots("Greek yogurt bowl")).toEqual(["breakfast"]);
    expect(portionStarSlots("Protein bar")).toEqual(["snack"]);
    expect(portionStarSlots("Chipotle chicken bowl")).toEqual(["lunch", "dinner"]);
  });
  it("its macros times the portion, its own name, and no ingredient lines it did not have", () => {
    const bowl = logged("Chipotle chicken bowl", 600, 45, 60, 20);
    const target = { proteinG: 56, carbsG: 75, fatG: 25 };
    const m = portionStarMeal(bowl, "lunch", target)!;
    expect(m.portion).toBe(1.25);
    expect(m.macros.proteinG).toBeCloseTo(56.25);
    expect(m.displayLines).toEqual(["1¼ servings of the starred meal, as it was starred"]);
    expect(m.lines).toEqual([]);
    expect(m.coachStar).toBe(true);
    // a target it cannot land on in quarters (far too much protein for the meal) leaves it out of a built plan
    expect(portionStarMeal(bowl, "lunch", { proteinG: 120, carbsG: 20, fatG: 10 })).toBeNull();
    // and never at breakfast by its name
    expect(portionStarMeal(bowl, "breakfast", target)).toBeNull();
  });
});

describe("Add to plan scales the star to the meal it joins", () => {
  const planWith = (targets: { proteinTarget: number; carbsTarget: number; fatTarget: number }): MealPlanRow =>
    ({ meals: { daily: [{ mealId: "m1", title: "Lunch", ...targets, recipes: [] }] }, archetype: "standard", meal_count: 3, include_snack: false, carb_cycling: false, macros: null } as unknown as MealPlanRow);
  it("a starred library meal, ingredient by ingredient, to that meal's target", () => {
    const star = starOfCandidate(0);
    const big = { proteinTarget: Math.round(lunch.proteinG * 1.3), carbsTarget: Math.round(lunch.carbsG * 1.3), fatTarget: Math.round(lunch.fatG * 1.3) };
    const r = addStarredToPlan({ plan: planWith(big), bucket: "daily", mealId: "m1", star, rules: {}, clientFirst: "Sawyer" });
    expect(r.ok).toBe(true);
    const added = r.ok ? r.row.meals.daily[0].recipes!.at(-1)! : null;
    expect(added?.fromFavorite).toBe(true);
    expect(checkTolerance(added!.macros!, { proteinG: big.proteinTarget, carbsG: big.carbsTarget, fatG: big.fatTarget }).ok).toBe(true);
    expect(caloriesOf(added!.macros!.proteinG, added!.macros!.carbsG, added!.macros!.fatG)).toBeGreaterThan(star.calories ?? 0);
  });
  it("a logged meal, as whole portions", () => {
    const bowl = logged("Chipotle chicken bowl", 600, 45, 60, 20);
    const r = addStarredToPlan({ plan: planWith({ proteinTarget: 56, carbsTarget: 75, fatTarget: 25 }), bucket: "daily", mealId: "m1", star: bowl, rules: {}, clientFirst: "Sawyer" });
    const added = r.ok ? r.row.meals.daily[0].recipes!.at(-1)! : null;
    expect(added?.ingredients).toEqual(["1¼ servings of the starred meal, as it was starred"]);
    expect(added?.macros?.proteinG).toBe(56);
  });
  it("a whole-portion star is refused for a keto, carnivore or paleo client, and when it brings more carbs than the meal allows", () => {
    const bowl = logged("Chipotle chicken bowl", 600, 45, 60, 20);
    for (const dietType of ["keto", "carnivore", "paleo"]) {
      const r = addStarredToPlan({ plan: planWith({ proteinTarget: 56, carbsTarget: 75, fatTarget: 25 }), bucket: "daily", mealId: "m1", star: bowl, rules: { dietType }, clientFirst: "Sawyer" });
      expect(r.ok, dietType).toBe(false);
    }
    const ketoPlan = { ...planWith({ proteinTarget: 56, carbsTarget: 75, fatTarget: 25 }), archetype: "keto" } as MealPlanRow;
    expect(addStarredToPlan({ plan: ketoPlan, bucket: "daily", mealId: "m1", star: bowl, rules: {}, clientFirst: "Sawyer" }).ok).toBe(false);
    const pasta = logged("Pasta bake", 700, 25, 120, 12);
    const r = addStarredToPlan({ plan: planWith({ proteinTarget: 50, carbsTarget: 30, fatTarget: 30 }), bucket: "daily", mealId: "m1", star: pasta, rules: {}, clientFirst: "Sawyer" });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toContain("more carbs");
  });
  it("still refuses a star against the client's food rules", () => {
    const shrimp = logged("Shrimp fried rice", 640, 40, 80, 16);
    const r = addStarredToPlan({ plan: planWith({ proteinTarget: 40, carbsTarget: 80, fatTarget: 16 }), bucket: "daily", mealId: "m1", star: shrimp, rules: { allergies: ["shellfish"] }, clientFirst: "Sawyer" });
    expect(r.ok).toBe(false);
  });
});

describe("wiring", () => {
  it("every build reads the coach's stars, and the planner marks them", () => {
    expect(read("lib/library-data.ts")).toContain('.from("recipe_favorites")');
    expect(read("lib/library-meal-plan.ts")).toContain("starred: args.libraryData?.starred ?? [],");
    expect(read("components/coach/desktop/meal-plan-generator.tsx")).toContain('title="From your favorites" aria-label="From your favorites" data-from-favorite');
    expect(read("components/coach/nutrition/favorite-meals-list.tsx")).toContain("const loaded = recipeKey && me ? await loadCoachRecipe(supabase, recipeKey, me.id) : null;");
  });
});

describe("Add to plan, a starred coach recipe: the food rules are as strict as the builder's", () => {
  const line = (id: string, label: string, role: "protein_source" | "carb_source" | "fat_source", p: number, c: number, f: number, gramsRef: number, matchedDescription?: string) => ({
    id,
    label,
    role,
    proteinPer100g: p,
    carbsPer100g: c,
    fatPer100g: f,
    fixedDisplayText: null,
    usdaFdcId: matchedDescription ? 1000 + Number(id.slice(1)) : null,
    gramsRef,
    ...(matchedDescription ? { matchedDescription } : {}),
  });
  const crunch: LibraryRecipe = {
    id: "rec1",
    name: "Protein crunch",
    slot: "lunch",
    diets: ["omnivore"],
    keywords: [],
    lines: [line("l1", "Chicken breast", "protein_source", 31, 0, 3.6, 100), line("l2", "White rice", "carb_source", 2.8, 28, 0.3, 150), line("l3", "Crunch topping", "fat_source", 24, 21, 49, 20, "Peanuts, all types, dry-roasted")],
    mainProtein: "chicken",
    source: "coach",
  };
  // the star as it was saved, before its lines knew the matched foods
  const star: StarredMeal = { key: "meal:protein crunch", name: "Protein crunch", calories: 450, proteinG: 40, carbsG: 46, fatG: 14, meal: { recipeId: "rec1", recipeName: "Protein crunch", ingredients: ["Chicken breast", "White rice", "Crunch topping"], key: "r:rec1", lines: [{ name: "Crunch topping", label: "Crunch topping", grams: 20 }], macros: { proteinG: 40, carbsG: 46, fatG: 14, calories: 450 } } };
  const plan = { meals: { daily: [{ mealId: "m1", title: "Lunch", proteinTarget: 40, carbsTarget: 46, fatTarget: 14, recipes: [] }] }, archetype: "standard", meal_count: 3, include_snack: false, carb_cycling: false, macros: null } as unknown as MealPlanRow;
  it("a line matched to peanuts refuses it for a peanut allergy, though its label says only 'Crunch topping'", () => {
    const r = addStarredToPlan({ plan, bucket: "daily", mealId: "m1", star, rules: { allergies: ["peanut"] }, clientFirst: "Sawyer", coachRecipe: crunch });
    expect(r.ok).toBe(false);
    // and without the allergy it goes in, scaled from the recipe
    const ok = addStarredToPlan({ plan, bucket: "daily", mealId: "m1", star, rules: {}, clientFirst: "Sawyer", coachRecipe: crunch });
    expect(ok.ok).toBe(true);
  });
  it("a recipe tagged with the client's allergy when it was saved is refused, whatever its lines say", () => {
    const tagged: LibraryRecipe = { ...crunch, lines: crunch.lines.map((l) => ({ ...l, matchedDescription: undefined, usdaFdcId: null })), allergens: ["peanut"] };
    const r = addStarredToPlan({ plan, bucket: "daily", mealId: "m1", star, rules: { allergies: ["peanut"] }, clientFirst: "Sawyer", coachRecipe: tagged });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toContain("marked as containing peanut");
  });
  it("the starred meal itself is checked too, not only what it was scaled into", () => {
    const shrimpStar: StarredMeal = { ...star, name: "Shrimp bowl", meal: { ...star.meal, recipeName: "Shrimp bowl", ingredients: ["Shrimp"] } };
    const r = addStarredToPlan({ plan, bucket: "daily", mealId: "m1", star: shrimpStar, rules: { allergies: ["shellfish"] }, clientFirst: "Sawyer", coachRecipe: { ...crunch, lines: crunch.lines.map((l) => ({ ...l, matchedDescription: undefined })) } });
    expect(r.ok).toBe(false);
  });
});

describe("loadCoachRecipe reads only the coach's own recipe, with its matched foods, and fails closed", () => {
  const fake = (foods: { data: unknown; error: unknown }) => {
    const calls: string[] = [];
    const row = { id: "rec1", name: "Protein crunch", slot: "lunch", archetypes: ["omnivore"], keywords: [], recipe_ingredients: [{ id: "l1", sort_order: 1, label: "Crunch topping", role: "fat_source", protein_per_100g: 24, carbs_per_100g: 21, fat_per_100g: 49, fixed_display_text: null, usda_fdc_id: 77, grams_ref: 20 }] };
    const chain = (table: string) => {
      const q: Record<string, unknown> = {
        select: () => q,
        eq: (c: string, v: unknown) => (calls.push(`${table}.${c}=${String(v)}`), q),
        in: () => Promise.resolve(foods),
        maybeSingle: () => Promise.resolve({ data: row, error: null }),
      };
      return q;
    };
    return { calls, db: { from: chain } };
  };
  it("filters on the coach and fills the matched food", async () => {
    const f = fake({ data: [{ fdc_id: 77, description: "Peanuts, all types, dry-roasted" }], error: null });
    const recipe = await loadCoachRecipe(f.db as never, "rec1", "coach-1");
    expect(f.calls).toContain("recipes.created_by=coach-1");
    expect(recipe && recipe !== "unreadable" ? recipe.lines[0].matchedDescription : null).toBe("Peanuts, all types, dry-roasted");
  });
  it("a matched food that cannot be read: nothing is added", async () => {
    const f = fake({ data: null, error: { message: "boom" } });
    expect(await loadCoachRecipe(f.db as never, "rec1", "coach-1")).toBe("unreadable");
    expect(read("components/coach/nutrition/favorite-meals-list.tsx")).toContain('if (loaded === "unreadable") {');
  });
});

describe("Add to plan keeps a scaled star's diet", () => {
  const planFor = (t: { proteinG: number; carbsG: number; fatG: number }): MealPlanRow =>
    ({ meals: { daily: [{ mealId: "m1", title: "Lunch", proteinTarget: Math.round(t.proteinG), carbsTarget: Math.round(t.carbsG), fatTarget: Math.round(t.fatG), recipes: [] }] }, archetype: "standard", meal_count: 3, include_snack: false, carb_cycling: false, macros: null } as unknown as MealPlanRow);
  // a starred library meal, and the target it lands on
  const starredTemplate = (diet: DietType, wanted: (archetypes: string[]) => boolean) => {
    for (const recipe of ENABLED_TEMPLATES.filter((r) => r.slot === "lunch" && wanted(r.archetypes))) {
      const scaled = scaleTemplate(recipe, lunch);
      if (!scaled || !checkTolerance(scaled.macros, lunch).ok) continue;
      const meal = fromTemplateMeal(scaled, recipe);
      return { star: starFromChoice(choiceFromOption(optionFromScaled(meal)))!, target: meal.macros, diet };
    }
    throw new Error("no template");
  };
  it("an omnivore-only library meal is refused for a paleo or carnivore client", () => {
    for (const diet of ["paleo", "carnivore"] as const) {
      const { star, target } = starredTemplate(diet, (a) => a.includes("omnivore") && !a.includes(diet));
      const r = addStarredToPlan({ plan: planFor(target), bucket: "daily", mealId: "m1", star, rules: { dietType: diet }, clientFirst: "Sawyer" });
      expect(r.ok, diet).toBe(false);
      if (!r.ok) expect(r.reason).toContain(`can't go into Sawyer's ${diet} plan`);
    }
  });
  it("a library meal made for that diet still goes in", () => {
    const { star, target } = starredTemplate("paleo", (a) => a.includes("paleo"));
    expect(addStarredToPlan({ plan: planFor(target), bucket: "daily", mealId: "m1", star, rules: { dietType: "paleo" }, clientFirst: "Sawyer" }).ok).toBe(true);
  });
  it("the same for a coach recipe: its own diets decide", () => {
    const line = (id: string, label: string, role: "protein_source" | "carb_source" | "fat_source", p: number, c: number, f: number, gramsRef: number) => ({ id, label, role, proteinPer100g: p, carbsPer100g: c, fatPer100g: f, fixedDisplayText: null, usdaFdcId: null, gramsRef });
    const bowl: LibraryRecipe = { id: "rec9", name: "Chicken and rice", slot: "lunch", diets: ["omnivore"], keywords: [], lines: [line("l1", "Chicken breast", "protein_source", 31, 0, 3.6, 100), line("l2", "White rice", "carb_source", 2.8, 28, 0.3, 150), line("l3", "Olive oil", "fat_source", 0, 0, 100, 10)], mainProtein: "chicken", source: "coach" };
    const star: StarredMeal = { key: "meal:chicken and rice", name: "Chicken and rice", calories: 400, proteinG: 35, carbsG: 42, fatG: 14, meal: { recipeId: "rec9", recipeName: "Chicken and rice", ingredients: ["Chicken breast", "White rice", "Olive oil"], key: "r:rec9", macros: { proteinG: 35, carbsG: 42, fatG: 14, calories: 434 } } };
    const plan = planFor({ proteinG: 35, carbsG: 42, fatG: 14 });
    const refused = addStarredToPlan({ plan, bucket: "daily", mealId: "m1", star, rules: { dietType: "paleo" }, clientFirst: "Sawyer", coachRecipe: bowl });
    expect(refused.ok).toBe(false);
    if (!refused.ok) expect(refused.reason).toContain("can't go into Sawyer's paleo plan");
    expect(addStarredToPlan({ plan, bucket: "daily", mealId: "m1", star, rules: { dietType: "paleo" }, clientFirst: "Sawyer", coachRecipe: { ...bowl, diets: ["omnivore", "paleo"] } }).ok).toBe(true);
    // an omnivore client is unchanged
    expect(addStarredToPlan({ plan, bucket: "daily", mealId: "m1", star, rules: {}, clientFirst: "Sawyer", coachRecipe: bowl }).ok).toBe(true);
  });
});
