import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { addStarredToPlan, caloriesProteinLine, choicesOfSnapshots, mealsOfPlan, rowToStarredMeal, starFromChoice, starFromLogged, starInsertRow, starredMealKey } from "./starred-meals";
import { EDITED_BY_HAND_RATIONALE, LIBRARY_WEEK_RATIONALE } from "./week-replace";
import type { MealPlanRow, MealRecipeChoice } from "./meal-plan-assignment";

// Nov 19 revamp (step 207): a coach stars any meal they see, and the Favorite meals tab lists them with calories, protein and "Add to plan".
const src = (p: string) => readFileSync(join(__dirname, "..", p), "utf8").replace(/\r\n/g, "\n");

const steak: MealRecipeChoice = {
  recipeId: "l_steak_rice",
  recipeName: "Steak & Rice Bowl",
  ingredients: ["<strong>Sirloin:</strong> 150g"],
  source: "library",
  macros: { calories: 612.4, proteinG: 48.6, carbsG: 60, fatG: 18 },
  key: "t:l_steak_rice",
};
const plan = (meals: MealPlanRow["meals"], rationale: string | null = "Built by hand"): MealPlanRow => ({ archetype: "standard", meal_count: 3, include_snack: false, carb_cycling: false, rationale, macros: { daily: { calories: 2000 } }, meals });
const meal = (mealId: string, title: string, recipes: MealRecipeChoice[], extra: Record<string, unknown> = {}) => ({ mealId, title, proteinTarget: 40, carbsTarget: 50, fatTarget: 15, recipes, ...extra });
const oats: MealRecipeChoice = { recipeId: "b_oats", recipeName: "Protein Oats", ingredients: [], macros: { calories: 400, proteinG: 30, carbsG: 50, fatG: 8 } };

describe("a starred meal", () => {
  it("is one star whatever the spacing or capitals of its name", () => {
    expect(starredMealKey("  Steak   and Rice ")).toBe("meal:steak and rice");
    expect(starredMealKey("STEAK AND RICE")).toBe(starredMealKey("steak and rice"));
  });

  it("from a plan option: the name, the macros rounded, and the option itself kept for Add to plan", () => {
    const s = starFromChoice(steak)!;
    expect(s).toMatchObject({ key: "meal:steak & rice bowl", name: "Steak & Rice Bowl", calories: 612, proteinG: 49, carbsG: 60, fatG: 18 });
    expect(s.meal).toEqual(steak);
    expect(starFromChoice({ recipeId: null, recipeName: "  ", ingredients: [] })).toBeNull();
    // an option without macros keeps blanks, never zeros
    expect(starFromChoice({ recipeId: "x", recipeName: "Mystery", ingredients: [] })).toMatchObject({ calories: null, proteinG: null });
  });

  it("from a meal a client logged: what they logged, nothing made up", () => {
    const s = starFromLogged({ description: "Chipotle bowl", calories: 850, proteinG: 45, carbsG: 90, fatG: 30 })!;
    expect(s).toMatchObject({ key: "meal:chipotle bowl", calories: 850, proteinG: 45 });
    expect(s.meal).toEqual({ recipeId: null, recipeName: "Chipotle bowl", ingredients: [], macros: { calories: 850, proteinG: 45, carbsG: 90, fatG: 30 } });
    // only calories logged: no meal macros (a plan's checks would read them as real)
    expect(starFromLogged({ description: "Pizza", calories: 700 })!.meal.macros).toBeUndefined();
    expect(starFromLogged({ description: null, calories: 700 })).toBeNull();
  });

  it("is saved as the coach's own favorites row, kind meal, and read back the same", () => {
    const s = starFromChoice(steak)!;
    const row = starInsertRow("coach-1", s);
    expect(row).toMatchObject({ profile_id: "coach-1", recipe_id: s.key, kind: "meal", label: "Steak & Rice Bowl", calories: 612, protein_g: 49 });
    expect(rowToStarredMeal({ ...row, calories: "612", protein_g: "49", carbs_g: null, fat_g: null })).toMatchObject({ key: s.key, name: s.name, calories: 612, proteinG: 49, carbsG: null, meal: steak });
    // the meal carried over from a recipe (step 207): no macros, ingredient names only
    expect(rowToStarredMeal({ recipe_id: "meal:new recipe", label: "New Recipe", calories: null, protein_g: null, carbs_g: null, fat_g: null, meal: { recipeId: "r1", recipeName: "New Recipe", ingredients: [] } })).toMatchObject({ calories: null, meal: { ingredients: [] } });
    expect(rowToStarredMeal({ recipe_id: "x", label: "X", calories: null, protein_g: null, carbs_g: null, fat_g: null, meal: null })).toBeNull();
  });

  it("shows calories and protein first, a dash for what is not known", () => {
    expect(caloriesProteinLine({ calories: 1250, proteinG: 48 })).toBe("1,250 kcal · 48 g protein");
    expect(caloriesProteinLine({ calories: null, proteinG: null })).toBe("– kcal · – g protein");
  });
});

describe("Add to plan", () => {
  const rules = { allergies: [], intolerances: [], dislikes: [], dietType: null };

  it("lists the day's meals (a carb-cycling day: training-day meals, then rest-day meals)", () => {
    expect(mealsOfPlan({ daily: [meal("1", "Meal 1: Breakfast", []), meal("2", "Meal 2: Lunch", [])] }).map((m) => m.label)).toEqual(["Meal 1: Breakfast", "Meal 2: Lunch"]);
    expect(mealsOfPlan({ train: [meal("1", "Breakfast", [])], rest: [meal("1", "Breakfast", [])] }).map((m) => [m.bucket, m.label])).toEqual([["train", "Training day: Breakfast"], ["rest", "Rest day: Breakfast"]]);
    expect(mealsOfPlan(null)).toEqual([]);
  });

  it("adds the starred meal as one more option of the chosen meal, leaves the rest of the day alone, and marks a library day as changed by hand", () => {
    const day = plan({ daily: [meal("1", "Breakfast", [oats], { featuredIndex: 0 }), meal("2", "Lunch", [oats])] }, LIBRARY_WEEK_RATIONALE);
    const r = addStarredToPlan({ plan: day, bucket: "daily", mealId: "2", star: starFromChoice(steak)!, rules, clientFirst: "Sam" });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.row.meals.daily[1].recipes?.map((c) => c.recipeName)).toEqual(["Protein Oats", "Steak & Rice Bowl"]);
    expect(r.row.meals.daily[0]).toEqual(day.meals.daily[0]);
    expect(r.row.rationale).toBe(EDITED_BY_HAND_RATIONALE);
  });

  it("an older meal saved with the single-recipe fields keeps its recipe as the first option", () => {
    const day = plan({ daily: [{ mealId: "1", title: "Breakfast", proteinTarget: 40, carbsTarget: 50, fatTarget: 15, recipeId: "b_old", recipeName: "Old Oats", ingredients: [] }] });
    const r = addStarredToPlan({ plan: day, bucket: "daily", mealId: "1", star: starFromChoice(steak)!, rules, clientFirst: "Sam" });
    expect(r.ok && r.row.meals.daily[0].recipes?.map((c) => c.recipeName)).toEqual(["Old Oats", "Steak & Rice Bowl"]);
    expect(r.ok && "recipeName" in r.row.meals.daily[0]).toBe(false);
  });

  it("never adds a meal that breaks the client's food rules, or one already there, or to a meal that is gone", () => {
    const day = plan({ daily: [meal("1", "Breakfast", [oats])] });
    const peanut = starFromLogged({ description: "Peanut butter toast", calories: 400, proteinG: 15, carbsG: 40, fatG: 20 })!;
    const refused = addStarredToPlan({ plan: day, bucket: "daily", mealId: "1", star: peanut, rules: { ...rules, allergies: ["peanut"] }, clientFirst: "Sam" });
    expect(refused).toMatchObject({ ok: false });
    expect(!refused.ok && refused.reason).toMatch(/^Not added: .*Sam's food preferences\.$/);
    const again = addStarredToPlan({ plan: day, bucket: "daily", mealId: "1", star: starFromChoice(oats)!, rules, clientFirst: "Sam" });
    expect(!again.ok && again.reason).toBe("Protein Oats is already an option for Breakfast that day.");
    expect(addStarredToPlan({ plan: day, bucket: "daily", mealId: "9", star: starFromChoice(steak)!, rules, clientFirst: "Sam" }).ok).toBe(false);
  });
});

describe("the meals from before a plan change", () => {
  it("each option once, by name, in the order they appear, at most twelve", () => {
    const snaps = [
      { log_date: "2026-11-01", meals: { daily: [meal("1", "Breakfast", [oats, steak])] } },
      { log_date: "2026-11-02", meals: { daily: [meal("1", "Breakfast", [{ ...oats, recipeName: "protein  oats" }])] } },
      { log_date: "2026-11-03", meals: null },
    ];
    expect(choicesOfSnapshots(snaps).map((c) => c.recipeName)).toEqual(["Protein Oats", "Steak & Rice Bowl"]);
    expect(choicesOfSnapshots("nope")).toEqual([]);
    const many = [{ meals: { daily: Array.from({ length: 20 }, (_, i) => meal(String(i), "M", [{ recipeId: null, recipeName: `Meal ${i}`, ingredients: [] }])) } }];
    expect(choicesOfSnapshots(many)).toHaveLength(12);
  });
});

describe("the stars are on every meal the coach sees", () => {
  it("each planner option (the old vote and heart are gone), each meal from before a change, each meal a client logged", () => {
    const g = src("components/coach/desktop/meal-plan-generator.tsx");
    expect(g).toContain("<StarMealButton star={starFromChoice(choiceFromOption(opt))} />");
    expect(g).not.toContain("RecipeVoteFavorite");
    expect(src("components/coach/nutrition/plan-tries-panel.tsx")).toContain("<StarMealButton star={star} />");
    expect(src("components/coach/nutrition/client-nutrition.tsx")).toContain("previousMeals: choicesOfSnapshots((r as { previous_plan?: unknown }).previous_plan)");
    const glance = src("components/coach/nutrition/nutrition-glance.tsx");
    expect(glance).toContain("!it.skipped && it.loggedName ? <StarMealButton star={starFromLogged(");
  });
  it("the star is a 44px button, reads the coach's stars once per page, and says when a change did not save", () => {
    const star = src("components/coach/nutrition/star-meal-button.tsx");
    expect(star).toContain('className="w-11 h-11 shrink-0');
    expect(star).toContain("let starred: Promise<");
    expect(star.match(/from\("recipe_favorites"\)\.select/g)).toHaveLength(1);
    expect(star).toContain('.eq("kind", "meal")');
    expect(star).toContain("await saved(supabase.from(\"recipe_favorites\").insert(starInsertRow(s.userId, star))");
    // starring inside a planner option never ticks the option
    expect(star).toContain("e.preventDefault();\n    e.stopPropagation();");
  });
});

describe("the Favorite meals tab", () => {
  it("lists the coach's starred meals with calories, protein and Add to plan; the recipe builder is gone", () => {
    const tab = src("components/coach/nutrition/favorite-meals-tab.tsx");
    expect(tab).toContain('.eq("kind", "meal")');
    expect(tab).toContain('.eq("profile_id", userId)');
    const list = src("components/coach/nutrition/favorite-meals-list.tsx");
    expect(list).toContain("{caloriesProteinLine(m)}");
    expect(list).toContain("Add to plan");
    expect(list).toContain("No favorite meals yet.");
  });
  it("Add to plan reads the client's food rules first and adds nothing without an answer, then checks that a row really changed", () => {
    const list = src("components/coach/nutrition/favorite-meals-list.tsx");
    const at = (s: string) => list.indexOf(s);
    expect(at('from("client_nutrition_preferences")')).toBeGreaterThan(0);
    expect(at("if (prefsError || !prefsRow) {")).toBeLessThan(at("addStarredToPlan({"));
    expect(list).toContain('.eq("athlete_id", client.id).eq("log_date", day).select("log_date"),');
    expect(list).toContain("{ expectRows: true, message:");
    // a day with no plan is never given one made up here
    expect(list).toContain("has no meal plan on");
    expect(list).not.toMatch(/from\("meal_plans"\)\.(insert|upsert)/);
  });
  it("step 207 is a paste with its undo; the migration carries each coach recipe over as a starred meal", () => {
    const mig = src("supabase/migrations/0452_starred_meals.sql");
    expect(mig).toContain("check (kind in ('recipe', 'food', 'meal'))");
    expect(mig).toContain("insert into public.recipe_favorites (profile_id, recipe_id, kind, label, calories, protein_g, carbs_g, fat_g, meal)");
    expect(mig).toContain("on conflict (profile_id, recipe_id) do nothing;");
    expect(mig).not.toMatch(/delete from public\.recipes|drop table/i);
    const paste = src("supabase/apply/apply-step207-0452.sql");
    expect(paste).toContain(mig.trim());
    expect(paste.trim().endsWith("as row_security_on;")).toBe(true);
    expect(src("supabase/apply/undo-step207-0452.sql")).toContain("delete from public.recipe_favorites where kind = 'meal';");
  });
});
