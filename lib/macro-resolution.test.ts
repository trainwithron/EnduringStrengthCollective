import { describe, it, expect } from "vitest";
import { resolveDayMacros, calorieTargetForDate } from "./macro-resolution";

const standing = { calories: 2200, protein_g: 180, carbs_g: 220, fat_g: 70 };
const override = { calories: 1800, protein_g: 170, carbs_g: 150, fat_g: 60 };
const planMacros = { daily: { calories: 2000, protein: 175, carbs: 200, fats: 65 } };
const planMeals = { daily: [{ name: "Breakfast" }] };

describe("resolveDayMacros", () => {
  it("uses the standing target when nothing more specific exists", () => {
    const r = resolveDayMacros(null, null, null, standing);
    expect(r.source).toBe("standing");
    expect(r.target?.calories).toBe(2200);
    expect(r.target?.proteinG).toBe(180);
  });

  it("returns nothing when there is no target anywhere", () => {
    const r = resolveDayMacros(null, null, null, null);
    expect(r.target).toBeNull();
    expect(r.source).toBeNull();
  });

  it("an explicit day row beats the standing target", () => {
    const r = resolveDayMacros(override, null, null, standing);
    expect(r.source).toBe("override");
    expect(r.target?.calories).toBe(1800);
  });

  it("a meal plan beats the standing target", () => {
    const r = resolveDayMacros(null, planMacros, planMeals, standing);
    expect(r.source).toBe("meal_plan");
    expect(r.target?.calories).toBe(2000);
  });

  it("an explicit day row beats a meal plan, and says the plan differs", () => {
    const r = resolveDayMacros(override, planMacros, planMeals, standing);
    expect(r.source).toBe("override");
    expect(r.target?.calories).toBe(1800);
    expect(r.mealPlanDiffers).toBe(true);
  });

  it("does not flag a difference when the override matches the plan", () => {
    const r = resolveDayMacros({ ...override, calories: 2000 }, planMacros, planMeals, null);
    expect(r.mealPlanDiffers).toBe(false);
  });

  it("ignores an override row with no values at all", () => {
    const empty = { calories: null, protein_g: null, carbs_g: null, fat_g: null };
    const r = resolveDayMacros(empty, null, null, standing);
    expect(r.source).toBe("standing");
  });

  it("works for a targets-only client with a partial standing target", () => {
    const r = resolveDayMacros(null, null, null, { calories: 2500, protein_g: null, carbs_g: null, fat_g: null });
    expect(r.source).toBe("standing");
    expect(r.target?.calories).toBe(2500);
    expect(r.target?.proteinG).toBeNull();
  });
});

describe("calorieTargetForDate", () => {
  const overrides = new Map<string, number | null>([["2026-10-06", 1800]]);
  const plans = new Map<string, number | null>([["2026-10-07", 2000]]);

  it("prefers override, then plan, then standing", () => {
    expect(calorieTargetForDate("2026-10-06", overrides, standing, plans)).toBe(1800);
    expect(calorieTargetForDate("2026-10-07", overrides, standing, plans)).toBe(2000);
    expect(calorieTargetForDate("2026-10-08", overrides, standing, plans)).toBe(2200);
  });

  it("is null with no standing target and nothing on the day", () => {
    expect(calorieTargetForDate("2026-10-08", overrides, null, plans)).toBeNull();
  });
});

import { calorieSeriesWithStanding } from "./macro-resolution";

describe("calorieSeriesWithStanding", () => {
  const st = { calories: 2200, protein_g: null, carbs_g: null, fat_g: null, updated_at: "2026-10-03T12:00:00Z" };

  it("fills days from when the standing target was saved (one day of UTC slack), never earlier", () => {
    const s = calorieSeriesWithStanding([], st, "2026-10-01", "2026-10-05");
    expect(s.map((r) => r.date)).toEqual(["2026-10-02", "2026-10-03", "2026-10-04", "2026-10-05"]);
    expect(s.every((r) => r.value === 2200)).toBe(true);
  });

  it("keeps explicit day rows as written", () => {
    const s = calorieSeriesWithStanding([{ date: "2026-10-04", value: 1800 }], st, "2026-10-01", "2026-10-05");
    expect(s.find((r) => r.date === "2026-10-04")?.value).toBe(1800);
    expect(s.find((r) => r.date === "2026-10-05")?.value).toBe(2200);
  });

  it("returns only the explicit rows when there is no standing target", () => {
    const s = calorieSeriesWithStanding([{ date: "2026-10-02", value: 2000 }], null, "2026-10-01", "2026-10-05");
    expect(s).toEqual([{ date: "2026-10-02", value: 2000 }]);
  });
});

import { standingForDate } from "./macro-resolution";

describe("standingForDate", () => {
  const st = { calories: 2200, protein_g: null, carbs_g: null, fat_g: null, updated_at: "2026-10-03T12:00:00Z" };
  it("applies on and after the day it was saved, not before", () => {
    expect(standingForDate(st, "2026-10-01")).toBeNull();
    expect(standingForDate(st, "2026-10-02")).toBe(st); // one day of UTC slack
    expect(standingForDate(st, "2026-10-03")).toBe(st);
    expect(standingForDate(st, "2026-10-09")).toBe(st);
  });
  it("applies to every date when it has no saved-at", () => {
    const noDate = { ...st, updated_at: null };
    expect(standingForDate(noDate, "2020-01-01")).toBe(noDate);
  });
  it("is null when there is no standing target", () => {
    expect(standingForDate(null, "2026-10-03")).toBeNull();
  });
});
