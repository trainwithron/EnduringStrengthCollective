import { describe, it, expect, vi, beforeEach } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { emptyMealsOf, fillEmptyMeals, planAllergySwaps, rebuildNotice, safeDays, slotOfMeal, stillEmpty, type ConflictPlanRow, type LibraryPick } from "./allergy-conflict-rebuild";
import type { MealEntryPayload, MealRecipeChoice } from "./meal-plan-assignment";
import type { FoodRules } from "./allergen-check";

// Ron, Oct 21: a client puts their allergies in after a plan was assigned, "AI should automatically catch that and regenerate".
const read = (p: string) => readFileSync(join(__dirname, "..", p), "utf8").replace(/\r\n/g, "\n");
const TODAY = "2026-10-21";
const PEANUT: FoodRules = { allergies: ["peanut"], intolerances: [], dislikes: [], dietType: "omnivore" };
const choice = (name: string, line: string, key?: string): MealRecipeChoice => ({ recipeId: key ?? null, recipeName: name, ingredients: [line], ...(key ? { key } : {}) });
const meal = (mealId: string, title: string, recipes: MealRecipeChoice[], featuredIndex?: number): MealEntryPayload => ({ mealId, title, proteinTarget: 40, carbsTarget: 50, fatTarget: 15, recipes, ...(featuredIndex !== undefined ? { featuredIndex } : {}) });
const row = (log_date: string, meals: MealEntryPayload[]): ConflictPlanRow => ({ log_date, group_id: "g", archetype: "omnivore", meals: { daily: meals } });
const PB = choice("Peanut butter toast", "Peanut butter: 30g", "t:pb");
const OATS = choice("Oats and berries", "Oats: 60g", "t:oats");
const EGGS = choice("Egg scramble", "Egg: 120g", "t:eggs");
const libraryOf = (options: MealRecipeChoice[]): LibraryPick => (_slot, _t, exclude, count) => options.filter((o) => !exclude.has(o.key!)).slice(0, count);

describe("only the options that now break a rule are swapped", () => {
  it("a clashing option is replaced from the library; the other options, the other meals and the other days stay exactly as they were", () => {
    const plan = planAllergySwaps(
      [row(TODAY, [meal("1", "Meal 1: Breakfast", [OATS, PB]), meal("2", "Meal 2: Lunch", [EGGS])]), row("2026-10-22", [meal("1", "Meal 1: Breakfast", [OATS])])],
      PEANUT,
      TODAY,
      libraryOf([EGGS, choice("Yogurt bowl", "Greek yogurt: 200g", "t:yog")])
    );
    expect(plan.days).toHaveLength(1);
    const day = plan.days[0];
    expect(day.log_date).toBe(TODAY);
    expect(day.meals.daily[0].recipes!.map((r) => r.recipeName)).toEqual(["Oats and berries", "Yogurt bowl"]); // eggs are already on the day
    expect(day.meals.daily[1]).toEqual(meal("2", "Meal 2: Lunch", [EGGS]));
    expect(plan).toMatchObject({ removed: 1, replaced: 1, emptyMeals: [], allergyLabels: ["peanut"] });
  });
  it("works the same on a day the coach built by hand (only the meals are handed back; who built it and how it is counted are the database's to keep)", () => {
    const plan = planAllergySwaps([row(TODAY, [meal("1", "Meal 1: Breakfast", [PB], 0)])], PEANUT, TODAY, libraryOf([OATS]));
    expect(Object.keys(plan.days[0])).toEqual(["log_date", "group_id", "meals"]);
    expect(plan.days[0].meals.daily[0].recipes).toEqual([OATS]);
  });
  it("the featured option keeps its place when it stays; a removed one never comes back through the old single-recipe fields", () => {
    const plan = planAllergySwaps([row(TODAY, [{ ...meal("1", "Meal 1: Breakfast", [PB, OATS], 1), recipeName: "Peanut butter toast", ingredients: ["Peanut butter: 30g"] }])], PEANUT, TODAY, libraryOf([]));
    const m = plan.days[0].meals.daily[0];
    expect(m.recipes).toEqual([OATS]);
    expect(m.featuredIndex).toBeUndefined(); // oats is now first
    expect(m.recipeName).toBeNull();
    expect(m.ingredients).toEqual([]);
  });
  it("a past day is never touched; a plan with no clash changes nothing", () => {
    expect(planAllergySwaps([row("2026-10-20", [meal("1", "Breakfast", [PB])])], PEANUT, TODAY, libraryOf([OATS])).days).toHaveLength(0);
    expect(planAllergySwaps([row(TODAY, [meal("1", "Breakfast", [OATS])])], PEANUT, TODAY, libraryOf([EGGS])).days).toHaveLength(0);
  });
  it("a food they avoid counts too", () => {
    const plan = planAllergySwaps([row(TODAY, [meal("1", "Breakfast", [OATS, EGGS])])], { ...PEANUT, allergies: [], dislikes: ["oats"] }, TODAY, libraryOf([]));
    expect(plan.days[0].meals.daily[0].recipes).toEqual([EGGS]);
    expect(plan.avoidedFoods).toBe(true);
    expect(plan.allergyLabels).toEqual([]);
  });
});

describe("a meal nothing safe can fill", () => {
  const plan = planAllergySwaps([row(TODAY, [meal("snack", "Snack: Between-Meal Fuel", [PB])])], PEANUT, TODAY, libraryOf([]));
  it("is listed for the AI with its slot and target", () => {
    expect(plan.emptyMeals).toEqual([{ log_date: TODAY, archetype: "omnivore", bucket: "daily", mealId: "snack", slot: "snack", target: { proteinG: 40, carbsG: 50, fatG: 15 } }]);
  });
  it("is filled by the AI when it can be (only that meal), else stays empty, hidden from the client, and the coach is asked", () => {
    const copy = structuredClone(plan);
    fillEmptyMeals(copy, new Map([[`${TODAY}|daily|snack`, [choice("Hummus plate", "Hummus: 80g")]]]));
    expect(copy.days[0].meals.daily[0].recipes!.map((r) => r.recipeName)).toEqual(["Hummus plate"]);
    expect(stillEmpty(copy)).toEqual([]);
    expect(stillEmpty(plan)).toEqual([{ log_date: TODAY, title: "Snack: Between-Meal Fuel" }]);
    expect(rebuildNotice("Johann", plan, 1, 1)).toBe("Johann's peanut allergy clashed with their meal plan: 1 day rebuilt automatically. 1 meal needs you.");
  });
  it("the last check: a day that would still break a rule (an AI option with peanuts) is not written", () => {
    const copy = structuredClone(plan);
    fillEmptyMeals(copy, new Map([[`${TODAY}|daily|snack`, [choice("Satay", "Peanut sauce: 40g")]]]));
    expect(safeDays(copy, PEANUT)).toEqual({ safe: [], unsafe: [TODAY] });
  });
});

describe("the coach's notice and the slots", () => {
  it("names the allergies, in fixed words", () => {
    expect(rebuildNotice("Johann", { allergyLabels: ["peanut", "shellfish"], avoidedFoods: false }, 3, 0)).toBe("Johann's peanut and shellfish allergies clashed with their meal plan: 3 days rebuilt automatically.");
    expect(rebuildNotice("Ann", { allergyLabels: [], avoidedFoods: true }, 1, 2)).toBe("Ann's foods to avoid clashed with their meal plan: 1 day rebuilt automatically. 2 meals need you.");
  });
  it("reads the slot from the planner's meal titles", () => {
    expect(slotOfMeal({ mealId: "1", title: "Meal 1: Breakfast" })).toBe("breakfast");
    expect(slotOfMeal({ mealId: "1", title: "Meal 1: Fast-Breaking Window" })).toBe("breakfast");
    expect(slotOfMeal({ mealId: "4", title: "Meal 4: Dinner & Recovery" })).toBe("dinner");
    expect(slotOfMeal({ mealId: "snack", title: "Snack: Between-Meal Fuel" })).toBe("snack");
    expect(slotOfMeal({ mealId: "2", title: "Meal 2: Midday Meal 1" })).toBe("lunch");
  });
  it("finds the meals with no option on the coach's plan", () => {
    expect(emptyMealsOf([{ log_date: TODAY, meals: { daily: [meal("1", "Breakfast", []), meal("2", "Lunch", [OATS])] } }, { log_date: "2026-10-22", meals: null }])).toEqual([{ log_date: TODAY, title: "Breakfast" }]);
  });
});

// ---- the route, with the database, the library and the AI stood in ----
const db = vi.hoisted(() => ({
  prefs: { data: null as Record<string, unknown> | null, error: null as { message: string } | null },
  plans: [] as Record<string, unknown>[],
  rpc: [] as { fn: string; args: Record<string, unknown> }[],
  ai: "ok" as "ok" | "limit" | "unsafe",
  aiCalls: 0,
}));
vi.mock("@/lib/rate-limit", () => ({ rateLimitResponse: async () => null }));
vi.mock("@/lib/timezone", () => ({ getGroupCoachTimezone: async () => "America/Chicago", dateKeyInZone: () => "2026-10-21" }));
vi.mock("@/lib/library-data", () => ({ loadLibraryContext: async () => null }));
vi.mock("@/lib/library-selection", async (orig) => ({
  ...(await orig<typeof import("@/lib/library-selection")>()),
  // the library has nothing safe for a snack, and oats for anything else
  selectOptions: (slot: string, _t: unknown, ctx: { excludeKeys?: Set<string> }) => ({
    options: slot === "snack" || ctx.excludeKeys?.has("t:oats") ? [] : [{ key: "t:oats", recipeId: "b_oats", name: "Oats and berries", displayLines: ["Oats: 60g"], source: "library", macros: { proteinG: 10, carbsG: 50, fatG: 5, calories: 285 }, lines: [], mainProtein: null }],
    shortfall: 0,
    landed: 1,
    leftOutForRules: 0,
  }),
}));
vi.mock("@/lib/ai-meal-slot", async (orig) => ({
  ...(await orig<typeof import("@/lib/ai-meal-slot")>()),
  suggestMealSlotOptions: async () => {
    db.aiCalls++;
    if (db.ai === "limit") {
      const { AiRateLimitedError } = await import("@/lib/ai-usage");
      throw new AiRateLimitedError("budget_out");
    }
    const line = db.ai === "unsafe" ? "Peanut sauce: 40g" : "Hummus: 80g";
    return { options: [{ recipeName: "AI snack", ingredients: [{ rawLine: line, name: null, grams: 40, matchedDescription: null }], totalProtein: 10, totalCarbs: 10, totalFat: 5, totalKcal: 125, confident: true }], droppedForPreferences: 0, droppedForMacros: 0 };
  },
}));
function chain(result: () => unknown) {
  const c: any = {};
  for (const m of ["select", "eq", "in", "gte", "order", "limit"]) c[m] = () => c;
  c.maybeSingle = async () => result();
  c.then = (res: (v: unknown) => void) => Promise.resolve(result()).then(res);
  return c;
}
vi.mock("@/lib/supabase/server", () => ({
  createServerClient: async () => ({
    auth: { getUser: async () => ({ data: { user: { id: "ann" } } }) },
    from: () => chain(() => db.prefs),
  }),
}));
vi.mock("@/lib/supabase/service-role", () => ({
  createServiceRoleClient: () => ({
    from: (table: string) =>
      chain(() =>
        table === "group_memberships" ? { data: [{ group_id: "g" }], error: null } : table === "meal_plans" ? { data: db.plans, error: null } : table === "profiles" ? { data: { full_name: "Ann Lee" }, error: null } : { data: null, error: null }
      ),
    rpc: async (fn: string, args: Record<string, unknown>) => {
      db.rpc.push({ fn, args });
      return { data: (args.p_rows as unknown[]).length, error: null };
    },
  }),
}));

describe("the route", { timeout: 30000 }, () => {
  const prefsRow = { athlete_id: "ann", allergies: ["peanut"], dislikes: [], likes: [], intolerances: [], diet_type: "omnivore" };
  const plan = (log_date: string, meals: MealEntryPayload[], rationale = "Made by hand.") => ({ log_date, group_id: "g", archetype: "omnivore", rationale, macros: { daily: { calories: 2000 } }, meals: { daily: meals }, created_by: "coach" });
  beforeEach(() => {
    db.prefs = { data: prefsRow, error: null };
    db.plans = [];
    db.rpc = [];
    db.ai = "ok";
    db.aiCalls = 0;
  });
  const post = async () => {
    const { POST } = await import("@/app/api/nutrition/allergy-rebuild/route");
    const res = await POST();
    return { status: res.status, body: await res.json() };
  };

  it("unreadable food rules: nothing is changed (fail closed)", async () => {
    db.prefs = { data: null, error: { message: "network" } };
    db.plans = [plan(TODAY, [meal("1", "Meal 1: Breakfast", [PB])])];
    expect((await post()).status).toBe(500);
    expect(db.rpc).toHaveLength(0);
  });
  it("swaps the clashing option from the library and writes only that day's meals, with the coach's notice; it never uses one of the client's tries", async () => {
    db.plans = [plan(TODAY, [meal("1", "Meal 1: Breakfast", [PB, EGGS])]), plan("2026-10-23", [meal("1", "Meal 1: Breakfast", [EGGS])])];
    const r = await post();
    expect(r.body).toEqual({ daysChanged: 1, mealsNeedingCoach: 0 });
    expect(db.rpc).toHaveLength(1);
    expect(db.rpc[0].fn).toBe("apply_allergy_rebuild");
    expect(db.rpc[0].fn).not.toBe("apply_meal_plan_try");
    const rows = db.rpc[0].args.p_rows as { log_date: string; meals: { daily: { recipes: MealRecipeChoice[] }[] } }[];
    expect(rows.map((x) => Object.keys(x))).toEqual([["log_date", "meals"]]);
    expect(rows[0].meals.daily[0].recipes.map((c) => c.recipeName)).toEqual(["Egg scramble", "Oats and berries"]);
    expect(db.rpc[0].args.p_notice).toBe("Ann's peanut allergy clashed with their meal plan: 1 day rebuilt automatically.");
    expect(db.aiCalls).toBe(0);
  });
  it("a meal the library cannot fill goes to the AI (charged to the coach), checked again before it is written", async () => {
    db.plans = [plan(TODAY, [meal("snack", "Snack: Between-Meal Fuel", [PB])])];
    expect((await post()).body).toEqual({ daysChanged: 1, mealsNeedingCoach: 0 });
    expect(db.aiCalls).toBe(1);
    expect(read("app/api/nutrition/allergy-rebuild/route.ts")).toContain('meta: { feature: "meal_plan_slot", userId: user.id, coachId }');
  });
  it("the AI budget is used up: the meal stays empty (hidden from the client) and the coach is asked", async () => {
    db.ai = "limit";
    db.plans = [plan(TODAY, [meal("snack", "Snack: Between-Meal Fuel", [PB])])];
    expect((await post()).body).toEqual({ daysChanged: 1, mealsNeedingCoach: 1 });
    expect(db.rpc[0].args.p_notice).toBe("Ann's peanut allergy clashed with their meal plan: 1 day rebuilt automatically. 1 meal needs you.");
  });
  it("an AI option that still breaks a rule is never written", async () => {
    db.ai = "unsafe";
    db.plans = [plan(TODAY, [meal("snack", "Snack: Between-Meal Fuel", [PB])])];
    expect((await post()).body).toEqual({ daysChanged: 0, mealsNeedingCoach: 0 });
    expect(db.rpc).toHaveLength(0);
  });
  it("no answers saved, or nothing clashes: nothing is written", async () => {
    db.prefs = { data: null, error: null };
    expect((await post()).body).toEqual({ daysChanged: 0, mealsNeedingCoach: 0 });
    db.prefs = { data: prefsRow, error: null };
    db.plans = [plan(TODAY, [meal("1", "Meal 1: Breakfast", [EGGS])])];
    expect((await post()).body).toEqual({ daysChanged: 0, mealsNeedingCoach: 0 });
    expect(db.rpc).toHaveLength(0);
  });
});

describe("the first-visit question", () => {
  it("only for the client themself, only while they have never answered, only where meal plans exist; it blocks nothing", () => {
    const page = read("app/(coach)/groups/[groupId]/nutrition/page.tsx");
    expect(page).toContain("{macrosEnabled && !viewingOther && !prefsRow && !prefsError && <NutritionFirstVisitPrompt athleteId={athleteId} />}");
    const prompt = read("components/athlete/nutrition-first-visit-prompt.tsx");
    expect(prompt).toContain("Any food allergies or foods you avoid?");
    // None saves an empty row, their tastes only (the same write as My food preferences, which tells the coach)
    expect(prompt).toContain("allergies: none ? [] : allergies");
    expect(prompt).toContain('upsert(preferencesToRow(prefs, athleteId, { onlyTastes: true }), { onConflict: "athlete_id" })');
    expect(prompt).toContain("const rebuilt = named ? await runAllergyRebuild() : null;");
  });
  it("My food preferences runs the same rebuild when they add an allergy or a food to avoid", () => {
    expect(read("components/athlete/nutrition-preferences-card.tsx")).toContain("const rebuilt = added ? await runAllergyRebuild() : null;");
  });
  it("the coach sees the automatic rebuild (no Put back), and any meal it could not fill", () => {
    const panel = read("components/coach/nutrition/plan-tries-panel.tsx");
    expect(panel).toContain("Rebuilt automatically on {shortDateLabel(t.requestedAt.slice(0, 10))}:");
    expect(panel).toContain('const latestId = latest && latest.source === "client" ? latest.id : null;');
    expect(read("components/coach/nutrition/client-nutrition.tsx")).toContain("data-rebuilt-empty");
  });
});
