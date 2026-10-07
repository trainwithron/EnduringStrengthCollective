import { describe, expect, it } from "vitest";
import { buildFoodWeek, type FoodEntryRow } from "@/lib/food-week";

const row = (log_date: string, calories: number, protein_g: number, status = "ate_it", meal_slot: string | null = "Breakfast"): FoodEntryRow => ({
  log_date,
  meal_slot,
  status,
  description: "x",
  calories,
  protein_g,
  carbs_g: 10,
  fat_g: 5,
});

const target = () => ({ calories: 2000, proteinG: 150 });

describe("the 7-day food view", () => {
  it("is seven days oldest first, ending today, with weekday names from the dates themselves", () => {
    const w = buildFoodWeek({ entries: [], todayKey: "2026-10-07", targetFor: () => null });
    expect(w.days.map((d) => d.dateKey)).toEqual(["2026-10-01", "2026-10-02", "2026-10-03", "2026-10-04", "2026-10-05", "2026-10-06", "2026-10-07"]);
    expect(w.days.map((d) => d.weekday)).toEqual(["Thu", "Fri", "Sat", "Sun", "Mon", "Tue", "Wed"]);
    expect(w.days[6].isToday).toBe(true);
    expect(w.days.filter((d) => d.isToday)).toHaveLength(1);
  });
  it("crosses a month and year end", () => {
    const w = buildFoodWeek({ entries: [], todayKey: "2027-01-03", targetFor: () => null });
    expect(w.days[0].dateKey).toBe("2026-12-28");
    expect(w.days[6].dateKey).toBe("2027-01-03");
  });
  it("sums a day's meals, ignoring a skipped meal's numbers, and counts the day as logged", () => {
    const w = buildFoodWeek({
      entries: [row("2026-10-07", 500, 40), row("2026-10-07", 700, 50, "quick_log", "Lunch"), row("2026-10-07", 900, 90, "skipped", "Dinner")],
      todayKey: "2026-10-07",
      targetFor: target,
    });
    const today = w.days[6];
    expect(today.logged).toBe(true);
    expect(today.calories).toBe(1200);
    expect(today.proteinG).toBe(90);
    expect(today.carbsG).toBe(20);
    expect(today.meals).toHaveLength(3);
    expect(today.meals[2].skipped).toBe(true);
    expect(today.caloriesPct).toBe(60);
  });
  it("a day with only skipped meals is not a logged day", () => {
    const w = buildFoodWeek({ entries: [row("2026-10-07", 800, 50, "skipped")], todayKey: "2026-10-07", targetFor: target });
    expect(w.days[6].logged).toBe(false);
    expect(w.days[6].calories).toBe(0);
    expect(w.days[6].caloriesPct).toBeNull();
    expect(w.loggedDays).toBe(0);
    expect(w.avgCalories).toBeNull();
  });
  it("counts logged days and averages over logged days only", () => {
    const w = buildFoodWeek({
      entries: [row("2026-10-05", 2000, 150), row("2026-10-06", 1000, 50), row("2026-10-02", 3000, 100)],
      todayKey: "2026-10-07",
      targetFor: target,
    });
    expect(w.loggedDays).toBe(3);
    expect(w.avgCalories).toBe(2000);
    expect(w.avgProteinG).toBe(100);
  });
  it("ignores entries outside the 7 days", () => {
    const w = buildFoodWeek({ entries: [row("2026-09-30", 2000, 150), row("2026-10-08", 2000, 150)], todayKey: "2026-10-07", targetFor: target });
    expect(w.loggedDays).toBe(0);
  });
  it("no target means no percent; null numbers count as zero, never NaN", () => {
    const w = buildFoodWeek({
      entries: [{ log_date: "2026-10-07", meal_slot: null, status: "ate_it", description: null, calories: null, protein_g: null, carbs_g: null, fat_g: null }],
      todayKey: "2026-10-07",
      targetFor: () => null,
    });
    expect(w.days[6].logged).toBe(true);
    expect(w.days[6].calories).toBe(0);
    expect(w.days[6].caloriesPct).toBeNull();
    expect(Number.isNaN(w.avgCalories as number)).toBe(false);
  });
});
