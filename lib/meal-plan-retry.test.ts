import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  MAX_PLAN_TRIES,
  MAX_RETRY_NOTE,
  NOTHING_UNDERSTOOD,
  mergeTastes,
  planChanged,
  readRetryNote,
  rebuildRows,
  retryDays,
  retryState,
  rulesForRetry,
  triesLeft,
  triesUsed,
  type ExistingPlanRow,
} from "./meal-plan-retry";
import { buildSelectionContext } from "./library-meal-plan";
import { offeredKeysFromPlans } from "./library-data";
import { clientTryNumber, clientTryRationale, EDITED_BY_HAND_RATIONALE, isLibraryRationale, LIBRARY_WEEK_RATIONALE, planWeekReplacement } from "./week-replace";
import { DEFAULT_PREFERENCES } from "./nutrition-preferences";
import type { FoodRules } from "./allergen-check";

const TODAY = "2026-10-08";
const day = (n: number) => {
  const d = new Date(Date.UTC(2026, 9, 8 + n));
  return d.toISOString().slice(0, 10);
};
const lite = (n: number, rationale: string | null) => ({ log_date: day(n), rationale });

describe("the rationale a rebuilt day carries", () => {
  it("is written and read back as the same try number, and only the exact words count", () => {
    expect(clientTryRationale(2)).toBe("Rebuilt at the client's request (try 2 of 3).");
    expect(clientTryNumber(clientTryRationale(1))).toBe(1);
    expect(clientTryNumber(clientTryRationale(3))).toBe(3);
    expect(clientTryNumber("Rebuilt at the client's request (try 4 of 3).")).toBeNull();
    expect(clientTryNumber(LIBRARY_WEEK_RATIONALE)).toBeNull();
    expect(clientTryNumber(null)).toBeNull();
  });
  it("a rebuilt day is still a library-built day; a hand-built or hand-edited one is not", () => {
    expect(isLibraryRationale(LIBRARY_WEEK_RATIONALE)).toBe(true);
    expect(isLibraryRationale(clientTryRationale(2))).toBe(true);
    expect(isLibraryRationale(EDITED_BY_HAND_RATIONALE)).toBe(false);
    expect(isLibraryRationale("Made by hand")).toBe(false);
    expect(isLibraryRationale(null)).toBe(false);
  });
  it("the coach's Build the week replaces a day a client's try rebuilt, as it replaces any library day", () => {
    const plan = planWeekReplacement({ dates: [day(0), day(1)], todayKey: TODAY, existing: [lite(0, clientTryRationale(1)), lite(1, "Made by hand")], replaceHandBuilt: false });
    expect(plan.write).toEqual([day(0)]);
    expect(plan.replacingLibrary).toEqual([day(0)]);
    expect(plan.skippedHand).toEqual([day(1)]);
  });
});

describe("tries used and left", () => {
  it("counts the highest try written on a day from today on", () => {
    expect(triesUsed([lite(0, LIBRARY_WEEK_RATIONALE), lite(1, LIBRARY_WEEK_RATIONALE)], TODAY)).toBe(0);
    expect(triesUsed([lite(0, clientTryRationale(2)), lite(1, clientTryRationale(1))], TODAY)).toBe(2);
    expect(triesUsed([lite(0, clientTryRationale(3))], TODAY)).toBe(3);
  });
  it("ignores days that have passed, and starts over when the coach assigns a new plan", () => {
    expect(triesUsed([lite(-1, clientTryRationale(3)), lite(0, LIBRARY_WEEK_RATIONALE)], TODAY)).toBe(0);
    expect(triesUsed([lite(0, LIBRARY_WEEK_RATIONALE), lite(1, LIBRARY_WEEK_RATIONALE)], TODAY)).toBe(0);
  });
  it("tries left never goes below zero", () => {
    expect(triesLeft(0)).toBe(MAX_PLAN_TRIES);
    expect(triesLeft(2)).toBe(1);
    expect(triesLeft(3)).toBe(0);
    expect(triesLeft(9)).toBe(0);
  });
});

describe("which days a try may rebuild, and what the box does", () => {
  it("rebuilds library days from today on; leaves hand-built days and past days alone", () => {
    const d = retryDays([lite(-2, LIBRARY_WEEK_RATIONALE), lite(0, LIBRARY_WEEK_RATIONALE), lite(1, "Made by hand"), lite(2, clientTryRationale(1)), lite(3, EDITED_BY_HAND_RATIONALE)], TODAY);
    expect(d.rebuild).toEqual([day(0), day(2)]);
    expect(d.skippedHand).toEqual([day(1), day(3)]);
  });
  it("is ready with the tries left, none_left after the third, hand_built when nothing can be rebuilt, no_plan with no days", () => {
    expect(retryState([lite(0, LIBRARY_WEEK_RATIONALE)], TODAY)).toEqual({ kind: "ready", triesLeft: 3 });
    expect(retryState([lite(0, clientTryRationale(2))], TODAY)).toEqual({ kind: "ready", triesLeft: 1 });
    expect(retryState([lite(0, clientTryRationale(3))], TODAY)).toEqual({ kind: "none_left" });
    expect(retryState([lite(0, "Made by hand"), lite(1, EDITED_BY_HAND_RATIONALE)], TODAY)).toEqual({ kind: "hand_built" });
    expect(retryState([], TODAY)).toEqual({ kind: "no_plan" });
    expect(retryState([lite(-3, LIBRARY_WEEK_RATIONALE)], TODAY)).toEqual({ kind: "no_plan" });
  });
});

describe("reading what the client typed (no AI)", () => {
  it("turns foods and a diet into things to avoid and like, with a summary", () => {
    const r = readRetryNote("no fish, loves chicken, hates mushrooms");
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.dislikes).toEqual(expect.arrayContaining(["fish", "mushrooms"]));
    expect(r.likes).toEqual(["chicken"]);
    expect(r.summary).toMatch(/fish/);
  });
  it("an allergen group named is a hard drop for this build, but is saved as something avoided, never as an allergy", () => {
    const r = readRetryNote("no dairy");
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.typed.allergies).toContain("dairy");
    expect(r.dislikes).toContain("dairy");
    const merged = mergeTastes(DEFAULT_PREFERENCES, r);
    expect(merged.dislikes).toContain("dairy");
    expect(merged.allergies).toEqual([]);
    const rules = rulesForRetry({ allergies: [], intolerances: [], dislikes: merged.dislikes, dietType: "omnivore" }, r);
    expect(rules.allergies).toContain("dairy");
  });
  it("a diet word counts for this build (the stricter wins) without touching the saved diet type", () => {
    const r = readRetryNote("vegetarian");
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const rules = rulesForRetry({ allergies: [], intolerances: [], dislikes: [], dietType: "omnivore" }, r);
    expect(rules.dietType).toBe("vegetarian");
    expect(mergeTastes(DEFAULT_PREFERENCES, r).dietType).toBe("omnivore");
  });
  it("says what to type when nothing could be understood, and never reads past the length limit", () => {
    for (const t of ["", "   ", "none", "asdf qwerty"]) {
      const r = readRetryNote(t);
      if (t === "asdf qwerty") expect(r.ok).toBe(true);
      else expect(r).toEqual({ ok: false, message: NOTHING_UNDERSTOOD });
    }
    const long = readRetryNote("no fish " + "x".repeat(1000));
    expect(long.ok && long.text.length <= MAX_RETRY_NOTE).toBe(true);
  });
  it("adds each food once and respects the size limit of a full list", () => {
    const r = readRetryNote("no fish");
    if (!r.ok) throw new Error("not understood");
    const once = mergeTastes({ ...DEFAULT_PREFERENCES, dislikes: ["fish"] }, r);
    expect(once.dislikes).toEqual(["fish"]);
    const full = mergeTastes({ ...DEFAULT_PREFERENCES, dislikes: Array.from({ length: 40 }, (_, i) => `food ${i}`) }, r);
    expect(full.dislikes).toHaveLength(40);
  });
});

const MACROS = { calories: 2200, protein: 170, carbs: 230, fats: 70 };
const planRow = (n: number, extra: Partial<ExistingPlanRow> = {}): ExistingPlanRow => ({
  log_date: day(n),
  archetype: "omnivore",
  meal_count: 4,
  include_snack: false,
  carb_cycling: false,
  rationale: LIBRARY_WEEK_RATIONALE,
  macros: { daily: MACROS },
  meals: null,
  created_by: "coach-1",
  ...extra,
});
const rules: FoodRules = { allergies: [], intolerances: [], dislikes: [], dietType: "omnivore" };

describe("the rebuild (library only)", () => {
  const base = [0, 1, 2].map((n) => planRow(n));
  const first = rebuildRows({ plan: base, days: base.map((r) => r.log_date), ctxFor: (a) => buildSelectionContext({ libraryData: null, rules, archetype: a }), rotateFeatured: true });

  it("writes the same shape the coach's build writes, keeping each day's own macros, meal count and author", () => {
    expect(first.rows.map((r) => r.log_date)).toEqual([day(0), day(1), day(2)]);
    for (const r of first.rows) {
      expect(r.macros).toEqual({ daily: MACROS });
      expect(r.meal_count).toBe(4);
      expect(r.created_by).toBe("coach-1");
      expect(Object.keys(r.meals)).toEqual(["daily"]);
      expect(r.meals.daily).toHaveLength(4);
      expect(r.meals.daily.every((m) => m.recipes.length > 0)).toBe(true);
    }
    expect(first.hasEmptyMeal).toBe(false);
  });
  it("leaves out days it was not asked to rebuild", () => {
    const some = rebuildRows({ plan: base, days: [day(1)], ctxFor: (a) => buildSelectionContext({ libraryData: null, rules, archetype: a }), rotateFeatured: true });
    expect(some.rows.map((r) => r.log_date)).toEqual([day(1)]);
  });
  it("builds a carb-cycling day for both of its day types", () => {
    const cyc = planRow(0, { carb_cycling: true, macros: { train: MACROS, rest: { ...MACROS, calories: 1900, carbs: 160 } } });
    const out = rebuildRows({ plan: [cyc], days: [day(0)], ctxFor: (a) => buildSelectionContext({ libraryData: null, rules, archetype: a }), rotateFeatured: true });
    expect(Object.keys(out.rows[0].meals).sort()).toEqual(["rest", "train"]);
    expect(out.rows[0].carb_cycling).toBe(true);
  });
  it("honors what the client asked to avoid: no fish anywhere in the rebuilt meals", () => {
    const noFish: FoodRules = { ...rules, dislikes: ["fish"] };
    const out = rebuildRows({ plan: base, days: base.map((r) => r.log_date), ctxFor: (a) => buildSelectionContext({ libraryData: null, rules: noFish, archetype: a }), rotateFeatured: true });
    const text = JSON.stringify(out.rows.map((r) => r.meals)).toLowerCase();
    expect(text).not.toMatch(/salmon|tuna|\bcod\b|tilapia|\bfish\b|trout|halibut|sardine|mackerel/);
  });
  it("a different plan is detected, and the same plan is not counted as a change", () => {
    const planWithMeals: ExistingPlanRow[] = base.map((r, i) => ({ ...r, meals: first.rows[i].meals as unknown as ExistingPlanRow["meals"] }));
    expect(planChanged(planWithMeals, first.rows)).toBe(false);
    // asked again with what was just offered moved down: the menu changes
    const recentlyOffered = offeredKeysFromPlans(planWithMeals.map((r) => ({ log_date: r.log_date, meals: r.meals })), TODAY);
    const ctxMix = (a: string) => ({ ...buildSelectionContext({ libraryData: null, rules, archetype: a, variety: "mix_it_up" }), recentlyOffered });
    const again = rebuildRows({ plan: planWithMeals, days: planWithMeals.map((r) => r.log_date), ctxFor: ctxMix, rotateFeatured: true });
    expect(planChanged(planWithMeals, again.rows)).toBe(true);
  });
  it("reports a meal left with no option at all, so the rebuild is not saved", () => {
    const impossible: FoodRules = { ...rules, dietType: "vegan", dislikes: ["tofu", "beans", "lentils", "rice", "oats", "bread", "potato", "pasta", "quinoa", "nuts", "soy", "vegetables", "fruit", "seeds"] };
    const out = rebuildRows({ plan: [planRow(0)], days: [day(0)], ctxFor: (a) => buildSelectionContext({ libraryData: null, rules: impossible, archetype: a }), rotateFeatured: true });
    expect(out.hasEmptyMeal).toBe(true);
  });
});

describe("the route and the screens are wired as designed", () => {
  const read = (rel: string) => readFileSync(join(__dirname, "..", rel), "utf8").replace(/\r\n/g, "\n");
  const route = read("app/api/nutrition/plan-retry/route.ts");
  it("only the signed-in client can ask, before anything is read or built", () => {
    expect(route.indexOf("Not authenticated")).toBeGreaterThan(-1);
    expect(route.indexOf('membership.role !== "athlete"')).toBeGreaterThan(route.indexOf("Not authenticated"));
    expect(route.indexOf("readRetryNote(")).toBeGreaterThan(route.indexOf('membership.role !== "athlete"'));
    expect(route.indexOf("createServiceRoleClient()")).toBeGreaterThan(route.indexOf("readRetryNote("));
  });
  it("never sends what the client typed to an AI", () => {
    expect(route).not.toMatch(/anthropic|callClaude|ai-usage|\/api\/ai\//i);
  });
  it("rebuilds only library days, refuses a fourth try, and applies through the server-only database function", () => {
    expect(route).toContain("retryDays(plan, todayKey)");
    expect(route).toContain("MAX_PLAN_TRIES");
    expect(route).toContain('service.rpc("apply_meal_plan_try"');
    expect(route).toContain("hasEmptyMeal");
    expect(route).toContain("planChanged(");
  });
  it("saves what they asked to avoid only after the plan was changed, and as tastes only", () => {
    expect(route.indexOf('rpc("apply_meal_plan_try"')).toBeLessThan(route.indexOf('from("client_nutrition_preferences").upsert'));
    expect(route).toContain("onlyTastes: true");
  });
  it("the box is only on the client's own meal plan screen, and a coach acting as them does not get it", () => {
    const page = read("app/(coach)/groups/[groupId]/nutrition/page.tsx");
    expect(page).toContain("!isActingAsOther && savedPlanMeals");
    const section = read("components/athlete/food-log-section.tsx");
    expect(section).toContain("MealPlanRetryBox");
  });
  it("the coach sees the tries and can put the latest one back in one tap", () => {
    const panel = read("components/coach/nutrition/plan-tries-panel.tsx");
    expect(panel).toContain('rpc("restore_meal_plan_try"');
    expect(read("components/coach/nutrition/client-nutrition.tsx")).toContain("<PlanTriesPanel");
  });
});
