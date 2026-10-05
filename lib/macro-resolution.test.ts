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

import { calorieSeriesWithStanding, latestStanding, standingForDate, type StandingHistory } from "./macro-resolution";

const row = (effective_from: string, calories: number | null, protein_g: number | null = null) => ({
  effective_from,
  calories,
  protein_g,
  carbs_g: null,
  fat_g: null,
});

describe("standing target history", () => {
  const history: StandingHistory = [row("2026-10-01", 2200, 180), row("2026-10-07", 2300, 190)];

  it("each day shows the target that was in force that day", () => {
    expect(standingForDate(history, "2026-09-30")).toBeNull();
    expect(standingForDate(history, "2026-10-01")?.calories).toBe(2200);
    expect(standingForDate(history, "2026-10-06")?.calories).toBe(2200);
    expect(standingForDate(history, "2026-10-07")?.calories).toBe(2300);
    expect(standingForDate(history, "2026-10-20")?.protein_g).toBe(190);
  });

  it("editing a value on Wednesday does not blank Monday and Tuesday", () => {
    const h: StandingHistory = [row("2026-10-05", 2200, 180), row("2026-10-07", 2200, 200)];
    expect(standingForDate(h, "2026-10-05")?.protein_g).toBe(180);
    expect(standingForDate(h, "2026-10-06")?.protein_g).toBe(180);
    expect(standingForDate(h, "2026-10-07")?.protein_g).toBe(200);
  });

  it("a row with no numbers removes the standing target from that date", () => {
    const h: StandingHistory = [row("2026-10-01", 2200), row("2026-10-08", null)];
    expect(standingForDate(h, "2026-10-05")?.calories).toBe(2200);
    expect(standingForDate(h, "2026-10-09")).toBeNull();
    expect(latestStanding(h)).toBeNull();
  });

  it("empty or missing history is no target", () => {
    expect(standingForDate([], "2026-10-05")).toBeNull();
    expect(standingForDate(null, "2026-10-05")).toBeNull();
    expect(latestStanding(undefined)).toBeNull();
  });

  it("latestStanding is the newest row, even one that has not taken effect yet", () => {
    expect(latestStanding(history)?.effective_from).toBe("2026-10-07");
  });
});

describe("calorieSeriesWithStanding", () => {
  it("fills each day from the target that applied that day", () => {
    const h: StandingHistory = [row("2026-10-02", 2200), row("2026-10-04", 2300)];
    const s = calorieSeriesWithStanding([], h, "2026-10-01", "2026-10-05");
    expect(s).toEqual([
      { date: "2026-10-02", value: 2200 },
      { date: "2026-10-03", value: 2200 },
      { date: "2026-10-04", value: 2300 },
      { date: "2026-10-05", value: 2300 },
    ]);
  });

  it("keeps explicit day rows as written", () => {
    const h: StandingHistory = [row("2026-10-02", 2200)];
    const s = calorieSeriesWithStanding([{ date: "2026-10-04", value: 1800 }], h, "2026-10-01", "2026-10-05");
    expect(s.find((r) => r.date === "2026-10-04")?.value).toBe(1800);
    expect(s.find((r) => r.date === "2026-10-05")?.value).toBe(2200);
  });

  it("returns only the explicit rows with no history", () => {
    const s = calorieSeriesWithStanding([{ date: "2026-10-02", value: 2000 }], [], "2026-10-01", "2026-10-05");
    expect(s).toEqual([{ date: "2026-10-02", value: 2000 }]);
  });

  it("stops filling after a removal row", () => {
    const h: StandingHistory = [row("2026-10-02", 2200), row("2026-10-04", null)];
    const s = calorieSeriesWithStanding([], h, "2026-10-01", "2026-10-06");
    expect(s.map((r) => r.date)).toEqual(["2026-10-02", "2026-10-03"]);
  });
});
