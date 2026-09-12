import { describe, it, expect } from "vitest";
import {
  classifyNutritionTrend,
  expectedTrendForPhase,
  isTrendAligned,
  computeNutritionWeeklySeries,
} from "./nutrition-trend-classifier";

describe("classifyNutritionTrend", () => {
  const asOf = new Date("2026-09-12T00:00:00");

  function buildRows(startDaysAgo: number, endDaysAgo: number, value: number): { date: string; value: number }[] {
    const rows: { date: string; value: number }[] = [];
    for (let d = startDaysAgo; d >= endDaysAgo; d--) {
      const date = new Date(asOf);
      date.setDate(date.getDate() - d);
      rows.push({ date: date.toISOString().slice(0, 10), value });
    }
    return rows;
  }

  it("classifies calories down + weight down as cutting", () => {
    const calorieRows = [...buildRows(41, 21, 2400), ...buildRows(20, 0, 2200)]; // -8.3%
    const weightRows = [...buildRows(41, 21, 200), ...buildRows(20, 0, 194)]; // -3%
    const result = classifyNutritionTrend(calorieRows, weightRows, asOf);
    expect(result!.trend).toBe("cutting");
  });

  it("classifies calories up + weight up as bulking", () => {
    const calorieRows = [...buildRows(41, 21, 2400), ...buildRows(20, 0, 2700)]; // +12.5%
    const weightRows = [...buildRows(41, 21, 180), ...buildRows(20, 0, 184)]; // +2.2%
    const result = classifyNutritionTrend(calorieRows, weightRows, asOf);
    expect(result!.trend).toBe("bulking");
  });

  it("classifies calories up + weight flat/down as reverse_dieting", () => {
    const calorieRows = [...buildRows(41, 21, 2200), ...buildRows(20, 0, 2300)]; // +4.5%
    const weightRows = [...buildRows(41, 21, 180), ...buildRows(20, 0, 179)]; // -0.5%, within flat band
    const result = classifyNutritionTrend(calorieRows, weightRows, asOf);
    expect(result!.trend).toBe("reverse_dieting");
  });

  it("classifies flat calories + flat weight as maintaining", () => {
    const calorieRows = [...buildRows(41, 21, 2400), ...buildRows(20, 0, 2410)];
    const weightRows = [...buildRows(41, 21, 180), ...buildRows(20, 0, 180.5)];
    const result = classifyNutritionTrend(calorieRows, weightRows, asOf);
    expect(result!.trend).toBe("maintaining");
  });

  it("classifies calories down but weight up as ambiguous — a real mismatch worth flagging", () => {
    const calorieRows = [...buildRows(41, 21, 2400), ...buildRows(20, 0, 2100)]; // -12.5%
    const weightRows = [...buildRows(41, 21, 180), ...buildRows(20, 0, 184)]; // +2.2%
    const result = classifyNutritionTrend(calorieRows, weightRows, asOf);
    expect(result!.trend).toBe("ambiguous");
  });

  it("returns null when there isn't enough data to judge", () => {
    const calorieRows = [{ date: "2026-09-10", value: 2300 }];
    const weightRows = [{ date: "2026-09-10", value: 180 }];
    expect(classifyNutritionTrend(calorieRows, weightRows, asOf)).toBeNull();
  });
});

describe("expectedTrendForPhase / isTrendAligned", () => {
  it("maps each phase to its expected trend", () => {
    expect(expectedTrendForPhase("reverse_diet")).toBe("reverse_dieting");
    expect(expectedTrendForPhase("cut")).toBe("cutting");
    expect(expectedTrendForPhase("bulk")).toBe("bulking");
  });

  it("confirms alignment when the classified trend matches the tagged phase", () => {
    expect(isTrendAligned({ trend: "cutting", calorieChangePct: -10, weightChangePct: -3 }, "cut")).toBe(
      true
    );
  });

  it("flags misalignment when the classified trend does not match the tagged phase", () => {
    expect(
      isTrendAligned({ trend: "ambiguous", calorieChangePct: -10, weightChangePct: 2 }, "cut")
    ).toBe(false);
    expect(
      isTrendAligned({ trend: "maintaining", calorieChangePct: 0, weightChangePct: 0 }, "bulk")
    ).toBe(false);
  });
});

describe("computeNutritionWeeklySeries", () => {
  const asOf = new Date("2026-09-12T00:00:00");

  function dailyRows(startDaysAgo: number, endDaysAgo: number, value: number): { date: string; value: number }[] {
    const rows: { date: string; value: number }[] = [];
    for (let d = startDaysAgo; d >= endDaysAgo; d--) {
      const date = new Date(asOf);
      date.setDate(date.getDate() - d);
      rows.push({ date: date.toISOString().slice(0, 10), value });
    }
    return rows;
  }

  it("indexes each series to its own first real week as 100", () => {
    // 6 weeks of steady 2000 kcal, steady 180 lb.
    const calorieRows = dailyRows(41, 0, 2000);
    const weightRows = dailyRows(41, 0, 180);
    const result = computeNutritionWeeklySeries(calorieRows, weightRows, asOf, 6);
    expect(result.calorieIndexed).toHaveLength(6);
    expect(result.calorieIndexed[0]).toBe(100);
    expect(result.calorieIndexed.every((v) => v === 100)).toBe(true);
    expect(result.weightIndexed.every((v) => v === 100)).toBe(true);
  });

  it("shows a real change relative to the first week", () => {
    // First 3 weeks at 2000, last 3 weeks at 2200 (+10%).
    const calorieRows = [...dailyRows(41, 21, 2000), ...dailyRows(20, 0, 2200)];
    const weightRows = dailyRows(41, 0, 180);
    const result = computeNutritionWeeklySeries(calorieRows, weightRows, asOf, 6);
    expect(result.calorieIndexed[0]).toBe(100);
    expect(result.calorieIndexed[5]).toBeCloseTo(110, 5);
  });

  it("leaves a week with no data as a gap (null), not a fake value", () => {
    // Only the most recent week has any data at all.
    const calorieRows = dailyRows(6, 0, 2000);
    const weightRows: { date: string; value: number }[] = [];
    const result = computeNutritionWeeklySeries(calorieRows, weightRows, asOf, 6);
    expect(result.calorieIndexed.slice(0, 5).every((v) => v === null)).toBe(true);
    expect(result.calorieIndexed[5]).toBe(100);
    expect(result.weightIndexed.every((v) => v === null)).toBe(true);
  });
});
