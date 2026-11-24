import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { SupabaseClient } from "@supabase/supabase-js";
import { combineItems, gramsForItem, itemText, macrosForGrams, matchFoodItem, parseItems, type ParsedFoodItem } from "@/lib/food-log-match";
import { FOOD_DATABASE_SOURCE, FOOD_ESTIMATE_SOURCE } from "@/lib/food-estimate-source";
import { clientPlanBlock } from "@/lib/client-plan-context";
import { latestHistory, matchAthleteInRoster, numbersInText, summarizeFoodLog, type ResolvedAthlete } from "@/lib/collective-intelligence-lookups";
import { recallDays } from "@/components/coach/nutrition/food-recall-note";
import type { FoodSearchResult } from "@/lib/food-search-run";

// Spotters keep up (Ron, Nov 23: "Make sure we're optimizing the spotting system to keep up as well").
const ROOT = join(__dirname, "..");
const read = (rel: string) => readFileSync(join(ROOT, rel), "utf8").replace(/\r\n/g, "\n");
const db = {} as SupabaseClient;

describe("the typed quick-log uses the real food database", () => {
  // what the model returns for "2 eggs and a cup of whole milk"
  const eggsAndMilk = parseItems({
    items: [
      { food: "egg", quantity: 2, unit: "large", grams: 100, calories: 150, proteinG: 12, carbsG: 1, fatG: 10 },
      { food: "whole milk", quantity: 1, unit: "cup", grams: 240, calories: 150, proteinG: 8, carbsG: 12, fatG: 8 },
    ],
  }) as ParsedFoodItem[];
  const usdaHit = (fdcId: number, kcal: number, protein: number, carbs: number, fat: number) => ({
    fdcId,
    description: "x",
    category: null,
    dataType: "Survey (FNDDS)",
    per100g: { kcal, protein_g: protein, carbs_g: carbs, fat_g: fat },
  });
  const search = async (_s: SupabaseClient, q: string): Promise<FoodSearchResult> => {
    if (q === "egg") return { hits: [usdaHit(1, 143, 12.6, 0.7, 9.5)], packaged: [], correctedTo: null, suggestion: null };
    if (q === "whole milk") return { hits: [usdaHit(2, 61, 3.3, 4.6, 3.2)], packaged: [], correctedTo: null, suggestion: null };
    return { hits: [], packaged: [], correctedTo: null, suggestion: null };
  };
  const detail = async (_s: SupabaseClient, fdcId: number) =>
    fdcId === 1
      ? { per100g: { kcal: 143, protein_g: 12.6, carbs_g: 0.7, fat_g: 9.5 }, portions: [{ seq: 1, description: "1 large", gramWeight: 50 }] }
      : { per100g: { kcal: 61, protein_g: 3.3, carbs_g: 4.6, fat_g: 3.2 }, portions: [{ seq: 1, description: "1 cup", gramWeight: 244 }] };

  it('"2 eggs and a cup of whole milk" comes from the USDA rows, scaled to the amounts', async () => {
    expect(eggsAndMilk).toHaveLength(2);
    const matched = await Promise.all(eggsAndMilk.map((i) => matchFoodItem(db, i, search, detail)));
    expect(matched.every((m) => m.matched)).toBe(true);
    // 2 x 50 g of egg at 143 kcal per 100 g; 244 g of milk at 61
    expect(matched[0]).toMatchObject({ text: "2 large egg", calories: 143, proteinG: 13, fatG: 10 });
    expect(matched[1]).toMatchObject({ text: "1 cup whole milk", calories: 149, proteinG: 8, carbsG: 11, fatG: 8 });
    const entry = combineItems(matched);
    expect(entry).toMatchObject({ description: "2 large egg, 1 cup whole milk", calories: 292, foodSource: FOOD_DATABASE_SOURCE });
  });

  it("a food nothing matches keeps the estimate, and the entry is tagged as one", async () => {
    const [unknown] = parseItems({ items: [{ food: "grandma's mystery casserole", quantity: 1, unit: "plate", grams: 350, calories: 520, proteinG: 25, carbsG: 50, fatG: 22 }] }) as ParsedFoodItem[];
    const m = await matchFoodItem(db, unknown, search, detail);
    expect(m).toMatchObject({ matched: false, calories: 520, proteinG: 25, carbsG: 50, fatG: 22 });
    expect(combineItems([m]).foodSource).toBe(FOOD_ESTIMATE_SOURCE);
    // one unknown food makes the whole entry an estimate
    const egg = await matchFoodItem(db, eggsAndMilk[0], search, detail);
    expect(combineItems([egg, m]).foodSource).toBe(FOOD_ESTIMATE_SOURCE);
  });

  it("a failed search keeps the estimate", async () => {
    const failing = async (): Promise<FoodSearchResult> => {
      throw new Error("down");
    };
    expect((await matchFoodItem(db, eggsAndMilk[0], failing, detail)).matched).toBe(false);
  });

  it("the amount: grams and ounces as typed, a USDA household measure by its weight, else the model's grams", () => {
    const portions = [{ seq: 1, description: "1 cup", gramWeight: 244 }, { seq: 2, description: "1 tablespoon", gramWeight: 15 }];
    expect(gramsForItem({ quantity: 150, unit: "g", grams: 1 }, portions)).toBe(150);
    expect(gramsForItem({ quantity: 2, unit: "oz", grams: 1 }, portions)).toBe(56.7);
    expect(gramsForItem({ quantity: 2, unit: "cups", grams: 1 }, portions)).toBe(488);
    expect(gramsForItem({ quantity: 1, unit: "tbsp", grams: 1 }, portions)).toBe(15);
    expect(gramsForItem({ quantity: 1, unit: "bowl", grams: 300 }, portions)).toBe(300);
    expect(gramsForItem({ quantity: null, unit: null, grams: 80 }, [])).toBe(80);
  });

  it("the model's answer is checked: names required, at most 12 foods, believable amounts", () => {
    expect(parseItems({ error: "x" })).toBeNull();
    expect(parseItems({ items: [{ food: "" }] })).toBeNull();
    const many = parseItems({ items: Array.from({ length: 20 }, (_, i) => ({ food: `food ${i}`, grams: 99999, calories: -5 })) })!;
    expect(many).toHaveLength(12);
    expect(many[0]).toMatchObject({ grams: 3000, calories: 0, quantity: null });
    expect(macrosForGrams({ protein_g: 10 }, 100)).toBeNull();
    expect(itemText({ food: "banana", quantity: null, unit: null })).toBe("banana");
  });

  it("the route splits with the model and looks each food up; the photo log is tagged as an estimate; no screen shows the tag", () => {
    const route = read("app/api/ai/parse-food-log/route.ts");
    expect(route).toContain("items.map((item) => matchFoodItem(supabase, item))");
    expect(route).toContain("combineItems(matched)");
    expect(route).not.toContain("deferred project");
    expect(read("components/athlete/photo-log-food-button.tsx")).toContain("food_source: FOOD_ESTIMATE_SOURCE");
    const form = read("components/athlete/meal-checkoff-list.tsx");
    expect(form).toContain("food_source: fromDatabase ? FOOD_DATABASE_SOURCE : FOOD_ESTIMATE_SOURCE");
    expect(FOOD_ESTIMATE_SOURCE).toBe("ai");
    // Clark Kent: the client's card never says AI
    const visible = form.split("\n").filter((l) => !/^\s*(\/\/|\*|\/\*|\{\/\*)/.test(l));
    expect(visible.filter((l) => /\bAI\b/.test(l))).toEqual([]);
    expect(form).not.toContain("{estimate.foodSource}");
  });
});

describe("the program AI reads the goal sheet", () => {
  it("adds the days a week, the effort and the obstacles, with the goals; nothing when nothing is on file", () => {
    const block = clientPlanBlock({
      sheet: { days_per_week: 3, work_willing: "  Hard,\n but I travel ", obstacles: "Night shifts" },
      goal: { goal_type: "weight_loss", custom_label: null, status: "confirmed", target_date: "2027-03-01" },
      subGoals: [{ title: "Walk 8k steps", status: "agreed" }, { title: "No soda", status: "declined" }, { title: "Done one", status: "done" }],
    })!;
    expect(block).toContain("Days a week they can realistically train: 3");
    expect(block).toContain('"Hard, but I travel"');
    expect(block).toContain('"Night shifts"');
    expect(block).toContain("by 2027-03-01");
    expect(block).toContain("Smaller goals: Walk 8k steps");
    expect(block).not.toContain("No soda");
    expect(block).toContain("The coach's own request always wins.");
    expect(clientPlanBlock({ sheet: null, goal: null, subGoals: [] })).toBeNull();
    expect(clientPlanBlock({ sheet: { days_per_week: null, work_willing: " ", obstacles: null }, goal: null, subGoals: [] })).toBeNull();
  });

  it("the whole-program builder, the day builder and the template picker read it for the client", () => {
    const gen = read("app/api/ai/generate-program/route.ts");
    expect(gen).toContain("loadClientPlanBlock(supabase, athleteId, groupId)");
    expect(gen).toContain("(clientPlanText ? `${clientPlanText}\\n\\n` : \"\")");
    expect(read("app/api/ai/build-day/route.ts")).toContain("loadClientPlanBlock(supabase, athleteId, groupId)");
    expect(read("app/api/ai/pick-template/route.ts")).toContain("loadClientPlanBlock(supabase, clientId, program.group_id as string)");
  });
});

describe("the coach's nutrition view: the 3-day recall when nothing is logged", () => {
  it("lists the days with an answer, in order; nothing without a recall", () => {
    expect(recallDays({ food_day_1: " Eggs, toast ", food_day_2: "", food_day_3: "Pizza", filled_at: null })).toEqual([
      { label: "Yesterday", text: "Eggs, toast" },
      { label: "3 days ago", text: "Pizza" },
    ]);
    expect(recallDays(null)).toEqual([]);
    expect(recallDays({ food_day_1: null, food_day_2: null, food_day_3: null, filled_at: null })).toEqual([]);
  });
  it("shows only when no day of the week is logged", () => {
    expect(read("components/coach/nutrition/client-nutrition.tsx")).toContain("{week.loggedDays === 0 && <FoodRecallNote recall={recall} firstName={firstName} />}");
  });
});

describe("Ask Spot keeps up", () => {
  it("keeps the latest 20 messages of a 25-message thread, oldest first", () => {
    const thread = Array.from({ length: 25 }, (_, i) => ({ n: i + 1 }));
    // what the database returns: newest first, limited to 20
    const read20 = [...thread].reverse().slice(0, 20);
    expect(latestHistory(read20).map((m) => m.n)).toEqual(Array.from({ length: 20 }, (_, i) => i + 6));
    const route = read("app/api/collective-intelligence/chat/route.ts");
    expect(route).toContain('.order("created_at", { ascending: false })\n    .limit(MAX_HISTORY_MESSAGES);\n  const history = latestHistory(priorMessages);');
  });

  it("matches names on the roster read once per turn", () => {
    const roster: ResolvedAthlete[] = [
      { athleteId: "a", groupId: "g", fullName: "Sam Lee" },
      { athleteId: "b", groupId: "g", fullName: "Sam Ortiz" },
    ];
    expect(matchAthleteInRoster(roster, "sam lee")).toEqual(roster[0]);
    expect(matchAthleteInRoster(roster, "Sam")).toBe("ambiguous");
    expect(matchAthleteInRoster(roster, "Kim")).toBe("not_found");
    const route = read("app/api/collective-intelligence/chat/route.ts");
    expect(route.match(/getCoachRoster\(/g)).toHaveLength(1);
  });

  it("has the goal sheet and food log lookups, and the goal lookup stays in the client's group", () => {
    const route = read("app/api/collective-intelligence/chat/route.ts");
    for (const n of ["goal_sheet_and_sub_goals", "food_log_summary"]) {
      expect(route).toContain(`"${n}",`);
      expect(route).toContain(`- ${n}(athleteName)`);
    }
    const lookups = read("lib/collective-intelligence-lookups.ts");
    const goalFn = lookups.slice(lookups.indexOf("export async function getGoalAndNutritionPhaseStatus"), lookups.indexOf("export function numbersInText"));
    expect(goalFn.match(/\.eq\("group_id", athlete\.groupId\)/g)).toHaveLength(2);
    expect(numbersInText('lose "20 lbs" by 2027', null)).toEqual([20, 2027]);
  });

  it("the food summary: days logged and the average on those days; skipped and imported food do not count", () => {
    const e = (log_date: string, calories: number, extra: Partial<{ status: string; food_source: string }> = {}) => ({
      log_date,
      status: extra.status ?? "quick_log",
      food_source: extra.food_source ?? null,
      calories,
      protein_g: 10,
      carbs_g: 20,
      fat_g: 5,
    });
    expect(summarizeFoodLog([e("2026-11-20", 1000), e("2026-11-20", 500), e("2026-11-21", 1500), e("2026-11-22", 9999, { status: "skipped" }), e("2026-11-19", 800, { food_source: "import" })])).toEqual({
      daysLogged: 2,
      avg: { calories: 1500, protein: 15, carbs: 30, fat: 8 },
    });
    expect(summarizeFoodLog([])).toEqual({ daysLogged: 0, avg: null });
  });

  it("speed: the exercise trend reads 180 days; the calendar Spotter's feedback read is limited", () => {
    expect(read("lib/collective-intelligence-lookups.ts")).toContain('.gte("completed_at", new Date(Date.now() - EXERCISE_TREND_DAYS * 86400000).toISOString())');
    expect(read("lib/calendar-spotter-phase2-gather.ts")).toContain('.eq("spotter_kind", "calendar").order("created_at", { ascending: false }).limit(300)');
  });
});
