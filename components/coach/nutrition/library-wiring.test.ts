import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";

const src = (rel: string) => readFileSync(new URL(rel, import.meta.url), "utf8");

const generator = src("../desktop/meal-plan-generator.tsx");
const cards = src("../../athlete/todays-meal-cards.tsx");
const foodLog = src("../../athlete/food-log-section.tsx");
const clientPage = src("../../../app/(coach)/groups/[groupId]/nutrition/page.tsx");
const data = src("../../../lib/library-data.ts");
const selection = src("../../../lib/library-selection.ts");
const week = src("../../../lib/week-build.ts");

// Phase 4b: the library-first meal builder, wired through the coach's planner and the client's Today's meals.
describe("the coach's planner builds from the library first", () => {
  it("a day and a week come from the library, not from the old engine; the old generator is no longer called", () => {
    expect(generator).toContain("generateLibraryDay(");
    expect(generator).toContain("generateLibraryWeek(");
    expect(generator).not.toContain("generateFullMealPlan");
    expect(generator).not.toContain("fetchCustomRecipes");
  });
  it("a build waits for the client's history and the coach's recipes, instead of building without them", () => {
    expect(generator).toContain("loadLibraryContext(supabase");
    expect(generator).toMatch(/if \(!libraryData\) \{\s*setError\("Still loading/);
  });
  it("Build the week asks before replacing days that already have a plan, and says what could not be filled", () => {
    expect(generator).toContain("window.confirm(");
    expect(generator).toContain('.upsert(rows, { onConflict: "athlete_id,log_date" })');
    expect(generator).toContain("Fewer than three library options for");
    const buildWeek = generator.slice(generator.indexOf("async function handleBuildWeek"), generator.indexOf("async function handleSaveToLibrary"));
    expect(buildWeek.indexOf("window.confirm(")).toBeGreaterThan(0);
    expect(buildWeek.indexOf("window.confirm(")).toBeLessThan(buildWeek.indexOf(".upsert(rows"));
  });
  it("every meal says how many options came from the library and how many are still to generate (never quietly fewer than three)", () => {
    expect(generator).toContain("from the library");
    expect(generator).toContain("to generate");
    expect(generator).toContain("Ask the Nutrition Spot");
  });
  it("what is saved keeps the option's lines, macros and source, and the featured option", () => {
    expect(generator).toContain("choiceFromOption(");
    expect(generator).toContain("featuredIndex");
  });
  it("an approved AI option can be saved to the coach's own library (no AI call), and a duplicate is told so", () => {
    expect(generator).toContain("buildAiRecipeRows(");
    expect(generator).toContain("Save to my library");
    expect(generator).toContain("23505");
    expect(generator).toContain("already in your library");
  });
  it("when the AI is unavailable, more of the library is offered (the client's rules still apply), not the old engine", () => {
    expect(generator).toContain("selectOptions(slot, specTarget(meal.spec)");
    expect(generator).not.toContain("generateMealOptions");
  });
});

describe("the client's Today's meals shows options and logs the one they ate", () => {
  it("is the card list when a plan is saved, and logs the option's own name and macros", () => {
    expect(foodLog).toContain("<TodaysMealCards");
    expect(clientPage).toContain("plan={savedPlanMeals ?");
    expect(cards).toContain("I ate this");
    expect(cards).toContain("choicesFeaturedFirst(meal)");
    expect(cards).toContain("description");
    expect(cards).toContain('"ate_it"');
    expect(cards).toContain("choice?.macros");
  });
  it("lines are shown as text, never HTML", () => {
    expect(cards).toContain("<IngredientLine text={ing} />");
    expect(cards).not.toContain("dangerouslySetInnerHTML");
  });
});

describe("what the builder reads", () => {
  it("never reads a client's starred foods for a coach's menu (stars are private); favorites come from what they ate", () => {
    expect(data).toContain("stars: []");
    expect(data).not.toContain('from("recipe_favorites")');
  });
  it("reads the new recipe columns softly, falling back to the old select before the release's database step", () => {
    expect(data).toContain("RECIPE_SELECT(true)");
    expect(data).toContain("RECIPE_SELECT(false)");
  });
  it("checks the client's rules again on what each meal really contains, before ranking", () => {
    expect(selection).toContain("checkLines(checkTextOf(m), ctx.rules)");
    expect(selection.indexOf("checkLines(")).toBeLessThan(selection.indexOf("rankScore(m, target, ctx)"));
  });
  it("a week avoids repeats and rotates the featured meal", () => {
    expect(week).toContain("pickFeatured(");
    expect(week).toContain("offeredDaysAgo");
  });
});

// The Assistant's review of 4b: fail closed, typed restrictions, which days a week may write, the smaller items.
describe("review fixes", () => {
  const clientNutritionSrc = src("./client-nutrition.tsx");
  const toolsSrc = src("../desktop/nutrition-tools.tsx");
  it("M1: a client's food rules that cannot be read stop the builder (nothing is built, saved or asked of the AI)", () => {
    expect(clientNutritionSrc).toContain("error: prefsReadError");
    expect(clientNutritionSrc).toContain("rulesReadable={!prefsReadError}");
    expect(toolsSrc).toContain("rulesReadable={rulesReadable}");
    expect(generator).toContain("rulesReadable = true");
    for (const fn of ["function handleGenerate()", "async function handleBuildWeek()", "async function handleAiSuggest(", "async function handleAiSuggestAll()"]) {
      const body = generator.slice(generator.indexOf(fn), generator.indexOf(fn) + 700);
      expect(body, fn).toContain("rulesReadable");
    }
    expect(generator).toContain("disabled={!rulesReadable}");
    expect(generator).toContain("Couldn't read this client's food rules, so nothing can be built.");
  });
  it("M2: the typed restrictions note is merged into the rules the library and the AI options are checked with", () => {
    expect(generator).toContain("mergeRules(foodRules, typedRules)");
    expect(generator).toContain("rules: effectiveRules");
    expect(generator).toContain("filterOptionsByRules(offered, effectiveRules)");
    expect(generator).toContain("Applied from your note:");
    expect(generator).not.toContain("rules: foodRules ?? {}");
  });
  it("M3: a week build skips passed days and hand-built days, lists the days it will replace, and only then writes", () => {
    const buildWeek = generator.slice(generator.indexOf("async function handleBuildWeek"), generator.indexOf("async function handleSaveToLibrary"));
    expect(buildWeek).toContain("planWeekReplacement(");
    expect(buildWeek).toContain("replacement.write.map((d) => ({");
    expect(buildWeek).toContain("dayList(replaced)");
    expect(buildWeek).toContain("LIBRARY_WEEK_RATIONALE");
    expect(buildWeek.indexOf("window.confirm(")).toBeLessThan(buildWeek.indexOf(".upsert(rows"));
    expect(generator).toContain("Also replace days I planned by hand");
  });
  it("S1: a saved recipe is checked by the real food each line was matched to, and by its own allergen tags", () => {
    expect(data).toContain('from("usda_foods")');
    expect(data).toContain("filter((r) => r.lines.every((l) => l.usdaFdcId === null))");
    expect(selection).toContain("allergyKeysOf(ctx.rules.allergies)");
    expect(selection).toContain("allergenTags");
  });
  it("S2: a second tap on 'I ate this' cannot log twice", () => {
    expect(cards).toContain("inFlight.current.has(meal.mealId)");
    expect(cards.indexOf("inFlight.current.has(meal.mealId)")).toBeLessThan(cards.indexOf('.from("food_log_entries")'));
  });
  it("S3: a carb-cycling client sees only the menu for today's day type, chosen once", () => {
    expect(cards).toContain("Is today a training day or a rest day?");
    expect(cards).toContain("shownBuckets");
    expect(cards).toContain("window.localStorage");
  });
});
