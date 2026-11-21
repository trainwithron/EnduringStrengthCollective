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
  it("an allergy keeps a star out", () => {
    const shrimp = logged("Shrimp fried rice", 640, 40, 80, 16);
    const target = { proteinG: 42, carbsG: 78, fatG: 17 };
    expect(scaledCandidates("lunch", target, ctxOf({ starred: [shrimp] })).some((m) => m.name === "Shrimp fried rice")).toBe(true);
    const sel = selectOptions("lunch", target, ctxOf({ starred: [shrimp], rules: { allergies: ["shellfish"] } }));
    expect(sel.options.some((m) => m.name === "Shrimp fried rice")).toBe(false);
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
    expect(read("components/coach/nutrition/favorite-meals-list.tsx")).toContain("const coachRecipe = recipeKey ? await loadCoachRecipe(supabase, recipeKey) : null;");
  });
});
