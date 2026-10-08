import { describe, expect, it } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { describeScalePlans, scalePlanDays, scaleSavedPlans } from "@/lib/scale-plans";
import { ENABLED_TEMPLATES, scaleTemplate } from "@/lib/meal-templates";
import { fromTemplateMeal } from "@/lib/scaled-meal";
import { choiceFromOption, optionFromScaled } from "@/lib/library-meal-plan";
import type { MealEntryPayload, MealRecipeChoice } from "@/lib/meal-plan-assignment";

const TARGET_SLOT = { proteinG: 40, carbsG: 60, fatG: 20 };
function lunch(skip = 0): MealRecipeChoice {
  let n = 0;
  for (const t of ENABLED_TEMPLATES.filter((x) => x.slot === "lunch" && x.archetypes.includes("omnivore"))) {
    const s = scaleTemplate(t, TARGET_SLOT);
    if (!s) continue;
    if (n++ < skip) continue;
    return choiceFromOption(optionFromScaled(fromTemplateMeal(s, t)));
  }
  throw new Error("no template fits");
}
const entry = (): MealEntryPayload => ({ mealId: "1", title: "Lunch", proteinTarget: 40, carbsTarget: 60, fatTarget: 20, recipes: [lunch(0), lunch(1), lunch(2)] });
// The protein the one meal in a test day really delivers: the day's header says the same, as a real saved plan does.
const P0 = Math.round(entry().recipes![0].macros!.proteinG);
const day = (log_date: string, calories = 2000) => ({
  log_date,
  macros: { daily: { calories, protein: P0, carbs: 200, fats: 60 } },
  meals: { daily: [entry()] },
});
const NEW = { calories: 2100, protein: Math.round(P0 * 1.05), carbs: 210, fats: 63 };

describe("scalePlanDays", () => {
  it("scales each saved day to the new target and takes the exact target for a daily day", () => {
    const r = scalePlanDays([day("2026-10-09"), day("2026-10-10")], NEW);
    expect(r.days).toBe(2);
    expect(r.updates.map((u) => u.log_date)).toEqual(["2026-10-09", "2026-10-10"]);
    expect(r.updates[0].macros.daily).toMatchObject({ calories: 2100, protein: NEW.protein, carbs: 210, fats: 63 });
    expect(r.proteinShort).toEqual([]);
    expect(r.report.optionsScaled + r.report.optionsDropped).toBeGreaterThanOrEqual(6);
  });
  it("a day already at the new target is left alone, not rewritten", () => {
    const r = scalePlanDays([day("2026-10-09", 2100), day("2026-10-10", 2000)], NEW);
    expect(r.days).toBe(1);
    expect(r.alreadyRight).toBe(1);
    expect(r.updates[0].log_date).toBe("2026-10-10");
  });
  it("a carb-cycling day is scaled by its average planned calories", () => {
    const cyc = { log_date: "2026-10-09", macros: { train: { calories: 2400, protein: 160, carbs: 300, fats: 60 }, rest: { calories: 1800, protein: 160, carbs: 150, fats: 60 } }, meals: { train: [entry()], rest: [entry()] } };
    const r = scalePlanDays([cyc], { calories: 2310, protein: 168, carbs: 200, fats: 60 });
    expect(r.days).toBe(1);
    expect(r.updates[0].macros.train).toMatchObject({ calories: 2640 });
    expect(r.updates[0].macros.rest).toMatchObject({ calories: 1980 });
  });
  it("a day it cannot read (an older list-shaped plan, no calories) is left alone and counted", () => {
    const r = scalePlanDays([{ log_date: "2026-10-09", macros: {}, meals: { daily: [] } }, { log_date: "2026-10-10", macros: { daily: { calories: 2000 } }, meals: [] }], NEW);
    expect(r.days).toBe(0);
    expect(r.unreadable).toBe(2);
  });
  it("a cut that holds protein warns: 2,400 to 1,800 with protein held leaves the meals short, and the header shows what the meals deliver", () => {
    const row = day("2026-10-09", 2400);
    const r = scalePlanDays([row], { calories: 1800, protein: P0, carbs: 150, fats: 50 });
    expect(r.days).toBe(1);
    expect(r.proteinShort).toHaveLength(1);
    expect(r.proteinShort[0]).toMatchObject({ date: "2026-10-09", targetG: P0 });
    expect(r.proteinShort[0].deliveredG).toBeLessThan(P0 * 0.9);
    // Not the exact target: the scaled protein, which is what the meals give.
    const written = r.updates[0].macros.daily as { calories: number; protein: number };
    expect(written.calories).toBe(1800);
    expect(written.protein).toBeLessThan(P0 * 0.9);
    const text = describeScalePlans(r);
    expect(text).toContain("g of protein against the " + P0 + " g target");
    expect(text).toContain("Rebuild it instead of scaling");
  });
  it("a day whose meals meet the new protein is not warned about", () => {
    const r = scalePlanDays([day("2026-10-09", 2400)], { calories: 1800, protein: Math.round(P0 * 0.75), carbs: 150, fats: 50 });
    expect(r.proteinShort).toEqual([]);
    expect((r.updates[0].macros.daily as { protein: number }).protein).toBe(Math.round(P0 * 0.75));
  });
  it("refuses a change that is too big (a typo: 220 for 2200 would squash every day)", () => {
    const r = scalePlanDays([day("2026-10-09"), day("2026-10-10")], { calories: 200, protein: 20, carbs: 20, fats: 5 });
    expect(r.days).toBe(0);
    expect(r.tooBig).toBe(2);
    expect(r.updates).toEqual([]);
    expect(describeScalePlans(r)).toMatch(/Nothing was scaled\..*too big.*rebuild the plan instead of scaling it/i);
    expect(scalePlanDays([day("2026-10-09")], { calories: 3300, protein: P0, carbs: 300, fats: 90 }).tooBig).toBe(1);
    // The edges are allowed.
    expect(scalePlanDays([day("2026-10-09")], { calories: 1000, protein: P0, carbs: 100, fats: 30 }).tooBig).toBe(0);
    expect(scalePlanDays([day("2026-10-09")], { calories: 3200, protein: P0, carbs: 300, fats: 90 }).tooBig).toBe(0);
  });
  it("does not change the rows it was given", () => {
    const rows = [day("2026-10-09")];
    const copy = JSON.stringify(rows);
    scalePlanDays(rows, NEW);
    expect(JSON.stringify(rows)).toBe(copy);
  });
});

describe("describeScalePlans", () => {
  it("tells the three empty cases apart", () => {
    expect(describeScalePlans(scalePlanDays([], NEW))).toMatch(/no saved plan days/i);
    expect(describeScalePlans(scalePlanDays([day("2026-10-09", 2100)], NEW))).toMatch(/already match/i);
    expect(describeScalePlans(scalePlanDays([{ log_date: "2026-10-09", macros: {}, meals: {} }], NEW))).toMatch(/cannot be scaled/i);
  });
  it("names what was scaled and what was left", () => {
    const text = describeScalePlans(scalePlanDays([day("2026-10-09"), day("2026-10-10", 2100)], NEW));
    expect(text).toContain("across 1 day");
    expect(text).toContain("1 day already matched");
  });
});

// A minimal stand-in for the two calls scaleSavedPlans makes.
function fakeDb(rows: unknown[], failOnDate?: string) {
  const written: { log_date: string; macros: unknown; meals: unknown }[] = [];
  const db = {
    from() {
      return {
        select() {
          const chain: Record<string, unknown> = {
            eq: () => chain,
            gte: () => chain,
            order: () => chain,
            limit: () => Promise.resolve({ data: rows, error: null }),
          };
          return chain;
        },
        update(values: { macros: unknown; meals: unknown }) {
          return {
            eq: () => ({
              eq: (_c: string, date: string) => {
                if (date === failOnDate) return Promise.resolve({ error: { message: "denied" } });
                written.push({ log_date: date, ...values });
                return Promise.resolve({ error: null });
              },
            }),
          };
        },
      };
    },
  };
  return { db: db as unknown as SupabaseClient, written };
}

describe("scaleSavedPlans", () => {
  it("writes only the changed columns for each scaled day", async () => {
    const { db, written } = fakeDb([day("2026-10-09"), day("2026-10-10")]);
    const r = await scaleSavedPlans(db, { athleteId: "a1", fromKey: "2026-10-08", target: NEW });
    expect(r.ok).toBe(true);
    expect(written.map((w) => w.log_date)).toEqual(["2026-10-09", "2026-10-10"]);
  });
  it("a failed write stops, says how far it got, and leaves the rest untouched", async () => {
    const { db, written } = fakeDb([day("2026-10-09"), day("2026-10-10"), day("2026-10-11")], "2026-10-10");
    const r = await scaleSavedPlans(db, { athleteId: "a1", fromKey: "2026-10-08", target: NEW });
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.written).toBe(1);
      expect(r.error).toContain("Stopped after 1 of 3");
    }
    expect(written.map((w) => w.log_date)).toEqual(["2026-10-09"]);
  });
});
