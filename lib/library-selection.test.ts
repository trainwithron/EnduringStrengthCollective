import { describe, expect, it } from "vitest";
import { favoriteSignals, normalizeName } from "./library-favorites";
import { isFavorite, selectOptions, varietySettings, type SelectionContext } from "./library-selection";
import type { LibraryRecipe } from "./library-scaling";
import { buildWeekPlan, type WeekSlotSpec } from "./week-build";
import { generateLibraryDay, generateLibraryWeek, choiceFromOption, optionFromScaled } from "./library-meal-plan";
import { choicesFeaturedFirst, mealRecipeChoices } from "./meal-plan-assignment";
import { checkPlanAgainstPreferences, filterPlanForClient } from "./plan-preference-check";
import { checkTolerance } from "@/lib/meal-templates/tolerance";
import { gridFor } from "@/lib/meal-templates/grid";
import { checkLines } from "./allergen-check";
import { checkTextOf } from "./scaled-meal";

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

describe("library-first selection", () => {
  it("offers three meals that really land on the target, with different main proteins where possible", () => {
    const sel = selectOptions("lunch", lunch, ctxOf());
    expect(sel.options).toHaveLength(3);
    expect(sel.shortfall).toBe(0);
    for (const m of sel.options) expect(checkTolerance(m.macros, lunch).ok).toBe(true);
    const families = sel.options.map((m) => m.mainProtein);
    expect(new Set(families).size).toBe(3);
  });
  it("is deterministic: the same inputs give the same menu", () => {
    expect(selectOptions("lunch", lunch, ctxOf()).options.map((m) => m.key)).toEqual(selectOptions("lunch", lunch, ctxOf()).options.map((m) => m.key));
  });
  it("never offers a meal that breaks an allergy, checked on what the meal really contains", () => {
    const rules = { allergies: ["peanut", "dairy", "egg"] };
    for (const slot of ["breakfast", "lunch", "dinner", "snack"] as const) {
      const t = gridFor("standard", slot)[2];
      const sel = selectOptions(slot, t, ctxOf({ rules }));
      for (const m of sel.options) expect(checkLines(checkTextOf(m), rules), `${slot} ${m.name}`).toEqual([]);
      expect(sel.leftOutForRules).toBeGreaterThanOrEqual(0);
    }
    const sel = selectOptions("breakfast", gridFor("standard", "breakfast")[2], ctxOf({ rules }));
    expect(sel.leftOutForRules).toBeGreaterThan(0);
  });
  it("reads the preparation text too: a client allergic to soy is not offered the teriyaki chicken", () => {
    const rules = { allergies: ["soy"] };
    const keys: string[] = [];
    for (const slot of ["lunch", "dinner"] as const) for (let i = 0; i < 6; i++) keys.push(...selectOptions(slot, gridFor("standard", slot)[i], ctxOf({ rules })).options.map((m) => m.key));
    expect(keys).not.toContain("t:d_chicken_pineapple_broccoli");
  });
  it("a diet rule removes meals that break it (vegetarian never sees meat)", () => {
    const sel = selectOptions("lunch", lunch, ctxOf({ diet: "vegetarian", rules: { dietType: "vegetarian" } }));
    for (const m of sel.options) expect(checkLines(checkTextOf(m), { dietType: "vegetarian" })).toEqual([]);
  });
  it("puts favorites first, by starred id or by name", () => {
    const base = selectOptions("lunch", lunch, ctxOf());
    const last = base.options[2];
    const byId = selectOptions("lunch", lunch, ctxOf({ favorites: { ids: new Set([last.recipeId]), names: new Set() } }));
    expect(byId.options[0].key).toBe(last.key);
    const byName = selectOptions("lunch", lunch, ctxOf({ favorites: { ids: new Set(), names: new Set([normalizeName(last.name)]) } }));
    expect(byName.options[0].key).toBe(last.key);
    expect(isFavorite(last, { ids: new Set([last.recipeId]), names: new Set() })).toBe(true);
  });
  it("moves a recently offered meal down when the coach mixes it up, but never a favorite", () => {
    const base = selectOptions("lunch", lunch, ctxOf());
    const first = base.options[0];
    const mixed = selectOptions("lunch", lunch, ctxOf({ mixItUp: true, recentlyOffered: new Map([[first.key, 1]]) }));
    expect(mixed.options.map((m) => m.key)).not.toContain(first.key);
    const fav = selectOptions("lunch", lunch, ctxOf({ mixItUp: true, recentlyOffered: new Map([[first.key, 1]]), favorites: { ids: new Set([first.recipeId]), names: new Set() } }));
    expect(fav.options[0].key).toBe(first.key);
    // Offered long enough ago is not demoted.
    const old = selectOptions("lunch", lunch, ctxOf({ mixItUp: true, recentlyOffered: new Map([[first.key, 20]]) }));
    expect(old.options[0].key).toBe(first.key);
  });
  it("ranks a meal with a food the client likes higher", () => {
    const base = selectOptions("lunch", lunch, ctxOf());
    const third = base.options[2];
    const likedFood = third.lines[0].name;
    const liked = selectOptions("lunch", lunch, ctxOf({ likes: [likedFood] }));
    expect(liked.options.map((m) => m.key)).toContain(third.key);
    expect(liked.options.findIndex((m) => m.key === third.key)).toBeLessThanOrEqual(base.options.findIndex((m) => m.key === third.key));
  });
  it("a keto snack has no library meal: it says three are missing so the screen offers to generate them", () => {
    const sel = selectOptions("snack", gridFor("keto", "snack")[2], ctxOf({ diet: "keto" }));
    expect(sel.options).toEqual([]);
    expect(sel.shortfall).toBe(3);
  });
  it("includes the coach's own saved recipes, scaled and checked like any other", () => {
    const mine: LibraryRecipe = {
      id: "c1",
      name: "Coach salmon bowl",
      slot: "lunch",
      diets: ["omnivore"],
      keywords: [],
      mainProtein: "salmon",
      source: "coach",
      lines: [
        { id: "1", label: "Salmon fillet", role: "protein_source", proteinPer100g: 20, carbsPer100g: 0, fatPer100g: 13, fixedDisplayText: null, usdaFdcId: null, gramsRef: 200 },
        { id: "2", label: "White rice", role: "carb_source", proteinPer100g: 2.7, carbsPer100g: 28, fatPer100g: 0.3, fixedDisplayText: null, usdaFdcId: null, gramsRef: 250 },
        { id: "3", label: "Peanut sauce", role: "fat_source", proteinPer100g: 0, carbsPer100g: 0, fatPer100g: 60, fixedDisplayText: null, usdaFdcId: null, gramsRef: 10 },
      ],
    };
    const t = { proteinG: 45, carbsG: 70, fatG: 30 };
    const open = selectOptions("lunch", t, ctxOf({ coachRecipes: [mine], favorites: { ids: new Set(["c1"]), names: new Set() } }));
    expect(open.options.map((m) => m.key)).toContain("r:c1");
    // A peanut allergy removes it, because the check reads the food's printed label.
    const allergic = selectOptions("lunch", t, ctxOf({ coachRecipes: [mine], favorites: { ids: new Set(["c1"]), names: new Set() }, rules: { allergies: ["peanut"] } }));
    expect(allergic.options.map((m) => m.key)).not.toContain("r:c1");
  });
});

describe("favorites from stars and from eating", () => {
  it("a starred recipe by id, a starred food by label, and a meal eaten three times in four weeks by name", () => {
    const f = favoriteSignals({
      stars: [
        { recipeId: "t:abc", kind: "recipe", label: null },
        { recipeId: null, kind: "food", label: "Chicken & Rice!" },
      ],
      eaten: [
        { description: "Greek yogurt bowl", logDate: "2026-10-01" },
        { description: "greek yogurt  bowl", logDate: "2026-10-03" },
        { description: "Greek Yogurt Bowl", logDate: "2026-10-05" },
        { description: "Tuna wrap", logDate: "2026-10-05" },
        { description: "Tuna wrap", logDate: "2026-10-06" },
        { description: "Old favorite", logDate: "2026-08-01" },
        { description: "Old favorite", logDate: "2026-08-02" },
        { description: "Old favorite", logDate: "2026-08-03" },
        { description: null, logDate: "2026-10-06" },
      ],
      todayKey: "2026-10-07",
    });
    expect(f.ids).toEqual(["t:abc"]);
    expect(f.names).toContain("chicken rice");
    expect(f.names).toContain("greek yogurt bowl");
    expect(f.names).not.toContain("tuna wrap");
    expect(f.names).not.toContain("old favorite");
  });
});

describe("a week from the library", () => {
  const dates = ["2026-10-04", "2026-10-05", "2026-10-06", "2026-10-07", "2026-10-08", "2026-10-09", "2026-10-10"];
  const specsFor = (): WeekSlotSpec[] => [
    { id: "1", slot: "breakfast", title: "Meal 1: Breakfast", target: gridFor("standard", "breakfast")[3] },
    { id: "2", slot: "lunch", title: "Meal 2: Lunch", target: gridFor("standard", "lunch")[3] },
    { id: "3", slot: "dinner", title: "Meal 3: Dinner", target: gridFor("standard", "dinner")[3] },
    { id: "snack", slot: "snack", title: "Snack", target: gridFor("standard", "snack")[3] },
  ];
  const week = buildWeekPlan({ dates, specsFor, ctx: ctxOf({ mixItUp: true }) });

  it("builds every day and slot with up to three real options and a featured one", () => {
    expect(Object.keys(week)).toEqual(dates);
    for (const d of dates) {
      expect(week[d]).toHaveLength(4);
      for (const r of week[d]) {
        expect(r.options.length).toBeGreaterThan(0);
        expect(r.featuredIndex).toBeGreaterThanOrEqual(0);
        expect(r.featuredIndex).toBeLessThan(r.options.length);
        expect(r.shortfall).toBe(3 - r.options.length);
      }
    }
  });
  it("the featured lunch is never the same two days in a row, and changes over the week", () => {
    const featured = dates.map((d) => {
      const r = week[d][1];
      return r.options[r.featuredIndex].key;
    });
    for (let i = 1; i < featured.length; i++) expect(featured[i]).not.toBe(featured[i - 1]);
    expect(new Set(featured).size).toBeGreaterThan(2);
  });
  it("no meal appears twice on the same day", () => {
    for (const d of dates) {
      const keys = week[d].flatMap((r) => r.options.map((m) => m.key));
      expect(new Set(keys).size).toBe(keys.length);
    }
  });
  it("a favorite repeats through the week and is not the featured meal while others can be", () => {
    const first = week[dates[0]][1].options[0];
    const withFav = buildWeekPlan({ dates, specsFor, ctx: ctxOf({ mixItUp: true, favorites: { ids: new Set([first.recipeId]), names: new Set() } }) });
    for (const d of dates) {
      const r = withFav[d][1];
      expect(r.options.map((m) => m.key)).toContain(first.key);
      expect(r.options[r.featuredIndex].key).not.toBe(first.key);
    }
  });
  it("is deterministic", () => {
    expect(JSON.stringify(buildWeekPlan({ dates, specsFor, ctx: ctxOf({ mixItUp: true }) }))).toBe(JSON.stringify(week));
  });
});

describe("the client's variety preference", () => {
  it("maps the three choices to how the menu moves", () => {
    expect(varietySettings("mix_it_up")).toEqual({ mixItUp: true, recentDays: 7, rotateFeatured: true });
    expect(varietySettings("few_favorites")).toEqual({ mixItUp: true, recentDays: 3, rotateFeatured: true });
    expect(varietySettings("same_most_days")).toEqual({ mixItUp: false, recentDays: 7, rotateFeatured: false });
    expect(varietySettings(null).mixItUp).toBe(true);
  });
  it("a client who wants the same meals most days gets the same menu and the same featured meal each day", () => {
    const dates = ["2026-10-04", "2026-10-05", "2026-10-06"];
    const specsFor = (): WeekSlotSpec[] => [{ id: "2", slot: "lunch", title: "Lunch", target: gridFor("standard", "lunch")[3] }];
    const w = buildWeekPlan({ dates, specsFor, ctx: ctxOf({ ...varietySettings("same_most_days") }), rotateFeatured: false });
    const sig = (d: string) => w[d][0].options.map((m) => m.key).join(",");
    expect(sig(dates[1])).toBe(sig(dates[0]));
    expect(sig(dates[2])).toBe(sig(dates[0]));
    for (const d of dates) expect(w[d][0].featuredIndex).toBe(0);
  });
});

describe("glue to the screens and the saved plan", () => {
  const macros = { calories: 2400, protein: 180, carbs: 250, fats: 70 };
  it("a day from the library has a GeneratedMeal per slot with macros, structured lines and the missing count", () => {
    const meals = generateLibraryDay(macros, 4, true, ctxOf());
    expect(meals.map((m) => m.spec.id)).toEqual(["1", "2", "3", "4", "snack"]);
    for (const m of meals) {
      expect(m.shortfall).toBe(3 - m.options.length);
      for (const o of m.options) {
        expect(o.macros!.proteinG).toBeGreaterThan(0);
        expect(o.lines!.length).toBeGreaterThan(0);
        expect(o.ingredients.length).toBeGreaterThan(0);
        expect(o.source).toBe("library");
      }
    }
  });
  it("an option is saved with its lines, macros and source, and reads back featured first", () => {
    const meals = generateLibraryDay(macros, 3, false, ctxOf());
    const m = meals[1];
    const choice = choiceFromOption(m.options[0]);
    expect(choice.lines!.length).toBeGreaterThan(0);
    expect(choice.macros!.proteinG).toBeGreaterThan(0);
    expect(choice.source).toBe("library");
    const entry = { mealId: m.spec.id, title: m.spec.title, proteinTarget: 1, carbsTarget: 1, fatTarget: 1, recipes: m.options.map(choiceFromOption), featuredIndex: 2 };
    expect(choicesFeaturedFirst(entry)[0]).toBe(entry.recipes[2]);
    expect(choicesFeaturedFirst(entry)).toHaveLength(3);
    expect(choicesFeaturedFirst({ ...entry, featuredIndex: undefined })[0]).toBe(entry.recipes[0]);
    expect(choicesFeaturedFirst({ ...entry, featuredIndex: 9 })[0]).toBe(entry.recipes[0]);
    expect(mealRecipeChoices(entry)).toHaveLength(3);
  });
  it("an older option (no lines, no macros) saves exactly what it always did", () => {
    const c = choiceFromOption({ recipeId: "x", recipeName: "Old", ingredients: ["a"] });
    expect(c).toEqual({ recipeId: "x", recipeName: "Old", ingredients: ["a"], isAi: undefined });
  });
  it("an AI option keeps its verified macros and is marked as AI", () => {
    const c = choiceFromOption({ recipeId: "ai-1", recipeName: "AI bowl", ingredients: ["a"], isAi: true, verifiedMacros: { protein: 40, carbs: 50, fat: 10, kcal: 410 } });
    expect(c.source).toBe("ai");
    expect(c.macros).toEqual({ proteinG: 40, carbsG: 50, fatG: 10, calories: 410 });
  });
  it("a saved option is checked again against the client's current rules, by food name and by label", () => {
    const meals = generateLibraryDay(macros, 3, false, ctxOf());
    const entries = meals.map((m) => ({ mealId: m.spec.id, title: m.spec.title, proteinTarget: 1, carbsTarget: 1, fatTarget: 1, recipes: m.options.map(choiceFromOption), featuredIndex: 1 }));
    const plan = { daily: entries };
    expect(checkPlanAgainstPreferences(plan, {})).toEqual([]);
    // A structured line alone (not in the printed text) is enough to flag an option.
    const sneaky = { daily: [{ ...entries[0], recipes: [{ ...entries[0].recipes[0], ingredients: ["plain text"], lines: [{ name: "Peanut butter", label: "Spread", grams: 30 }] }, entries[0].recipes[1]] }] };
    const flagged = checkPlanAgainstPreferences(sneaky, { allergies: ["peanut"] });
    expect(flagged).toHaveLength(1);
    expect(flagged[0].choiceIndex).toBe(0);
  });
  it("hiding a flagged option keeps the featured one if it is still shown", () => {
    const meals = generateLibraryDay(macros, 3, false, ctxOf());
    const m = meals[0];
    const recipes = m.options.map(choiceFromOption);
    recipes[0] = { ...recipes[0], lines: [{ name: "Peanut butter", label: "Peanut butter", grams: 30 }] };
    const entry = { mealId: m.spec.id, title: m.spec.title, proteinTarget: 1, carbsTarget: 1, fatTarget: 1, recipes, featuredIndex: 2 };
    const view = filterPlanForClient({ daily: [entry] }, { allergies: ["peanut"] });
    const shown = view.meals!.daily[0];
    expect(shown.recipes).toHaveLength(2);
    expect(shown.featuredIndex).toBe(1);
    expect(choicesFeaturedFirst(shown)[0]).toBe(recipes[2]);
    // When the featured one itself is hidden, there is no featured index left.
    const entry2 = { ...entry, featuredIndex: 0 };
    const view2 = filterPlanForClient({ daily: [entry2] }, { allergies: ["peanut"] });
    expect(view2.meals!.daily[0].featuredIndex).toBeUndefined();
  });
  it("a week from the library has the day's meals per date, with the featured index on each", () => {
    const dates = ["2026-10-04", "2026-10-05", "2026-10-06"];
    const w = generateLibraryWeek({ dates, dayMacros: () => macros, mealCount: 3, includeSnack: true, ctx: ctxOf() });
    expect(Object.keys(w)).toEqual(dates);
    for (const d of dates) {
      expect(w[d]).toHaveLength(4);
      for (const meal of w[d]) {
        expect(meal.featuredIndex).toBeLessThan(Math.max(1, meal.options.length));
        expect(meal.spec).toBeTruthy();
      }
    }
    expect(optionFromScaled).toBeTypeOf("function");
  });
});
