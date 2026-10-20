import { describe, it, expect } from "vitest";
import { estimateRealMaintenance, maintenanceSentence } from "./real-maintenance";
import { dailyCaloriesFromLog } from "./nutrition-tracking";
import { addDaysToKey } from "./date-key";

const TODAY = "2026-10-20";
const day = (i: number) => addDaysToKey(TODAY, -i); // i days ago
// Weigh-ins on every day of a window (i = days ago -> weight), and the same calories every day.
const weights = (days: number, weightOn: (i: number) => number) => Array.from({ length: days }, (_, i) => ({ date: day(i), weight: weightOn(i) }));
const eaten = (days: number, cal: number | ((i: number) => number)) => Array.from({ length: days }, (_, i) => ({ date: day(i), value: typeof cal === "number" ? cal : cal(i) }));
const base = { todayKey: TODAY, calorieFloor: 1200 };

describe("find my real maintenance", () => {
  it("flat weight: maintenance is what they ate", () => {
    const r = estimateRealMaintenance({ ...base, weights: weights(14, (i) => 180 + (i % 2) * 0.2), eatenDays: eaten(14, 2400) });
    expect(r).toMatchObject({ ready: true, maintenance: 2400, flat: true, windowDays: 14 });
  });
  it("losing 1 lb a week at 2,000 a day -> about 2,500", () => {
    // 14 days: the first week averages 1 lb more than the last week
    const r = estimateRealMaintenance({ ...base, weights: weights(14, (i) => (i >= 7 ? 181 : 180)), eatenDays: eaten(14, 2000) });
    expect(r).toMatchObject({ ready: true, maintenance: 2500, weeklyChangeLb: -1, windowDays: 14 });
    if (r.ready) expect(maintenanceSentence(r)).toBe("You ate about 2,000 a day and lost 1 lb a week, so you burn about 2,500.");
  });
  it("gaining: maintenance is below what they ate", () => {
    const r = estimateRealMaintenance({ ...base, weights: weights(14, (i) => (i >= 7 ? 180 : 181)), eatenDays: eaten(14, 3000) });
    expect(r).toMatchObject({ ready: true, maintenance: 2500, weeklyChangeLb: 1 });
    if (r.ready) expect(maintenanceSentence(r)).toContain("gained 1 lb a week");
  });
  it("uses 21 days when all three weeks qualify: the change is spread over 14 days between the week middles", () => {
    const r = estimateRealMaintenance({ ...base, weights: weights(21, (i) => (i >= 14 ? 182 : i >= 7 ? 181 : 180)), eatenDays: eaten(21, 2000) });
    // -2 lb over 14 days = -1 lb a week -> 2,000 + 2 x 3,500 / 14 = 2,500
    expect(r).toMatchObject({ ready: true, maintenance: 2500, weeklyChangeLb: -1, windowDays: 21 });
  });
  it("too few weigh-ins: not ready, and says how many more", () => {
    const w = [{ date: day(0), weight: 180 }, { date: day(2), weight: 180 }, { date: day(8), weight: 181 }];
    const r = estimateRealMaintenance({ ...base, weights: w, eatenDays: eaten(14, 2000) });
    expect(r).toEqual({ ready: false, missing: ["3 more weigh-ins"] });
  });
  it("too few days of food logged: not ready, and says what is missing", () => {
    const food = eaten(14, 2000).filter((_, i) => i !== 1 && i !== 2 && i !== 3);
    const r = estimateRealMaintenance({ ...base, weights: weights(14, () => 180), eatenDays: food });
    expect(r.ready).toBe(false);
    if (!r.ready) expect(r.missing).toEqual(["log food on 1 more day this week"]);
  });
  it("a day with only skipped meals is not a logged day", () => {
    const rows = [
      ...Array.from({ length: 14 }, (_, i) => ({ log_date: day(i), status: i < 3 ? "skipped" : "logged", calories: 2000 })),
    ];
    const r = estimateRealMaintenance({ ...base, weights: weights(14, () => 180), eatenDays: dailyCaloriesFromLog(rows) });
    expect(r.ready).toBe(false);
  });
  it("an answer more than 750 away from what they ate is not trusted", () => {
    // 4 lb lost in a week at 2,000 would mean 4,000: keep logging
    const r = estimateRealMaintenance({ ...base, weights: weights(14, (i) => (i >= 7 ? 184 : 180)), eatenDays: eaten(14, 2000) });
    expect(r).toEqual({ ready: false, missing: ["keep logging another week (the numbers so far do not add up yet)"] });
  });
  it("an answer under their calorie floor is not trusted", () => {
    const r = estimateRealMaintenance({ ...base, calorieFloor: 1500, weights: weights(14, (i) => (i >= 7 ? 180 : 181)), eatenDays: eaten(14, 1700) });
    // gaining 1 lb a week at 1,700 -> 1,200, under the floor
    expect(r.ready).toBe(false);
  });
  it("rounds to the nearest 50", () => {
    const r = estimateRealMaintenance({ ...base, weights: weights(14, (i) => (i >= 7 ? 180.8 : 180)), eatenDays: eaten(14, 2030) });
    // 2,030 + 0.8 x 500 = 2,430 -> 2,450
    expect(r).toMatchObject({ ready: true, maintenance: 2450, avgIntake: 2050 });
  });
});
