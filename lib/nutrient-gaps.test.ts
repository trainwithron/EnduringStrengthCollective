import { describe, expect, it } from "vitest";
import { GAP_BELOW_PCT, MIN_DAY_COVERAGE_PCT, MIN_DAY_KCAL, MIN_USABLE_DAYS, gapMessage, gapMessageForCoach, isUsableDay, percentOfTarget, summarizeNutrient, topGaps } from "@/lib/nutrient-gaps";
import type { DayTotals } from "@/lib/nutrient-day";

const day = (total: number | null, over: Partial<{ calories: number; coveragePct: number; entries: number }> = {}): DayTotals => ({
  date: "2026-10-01",
  calories: over.calories ?? 2000,
  entries: over.entries ?? 4,
  byKey: { calcium_mg: { total, reportingEntries: total == null ? 0 : 3, entries: 4, coveragePct: over.coveragePct ?? 90 } },
});

describe("a day counts for a nutrient only when it is a real day with enough detail", () => {
  it("needs enough calories, enough coverage and a reported total", () => {
    expect(isUsableDay(day(500), "calcium_mg")).toBe(true);
    expect(isUsableDay(day(500, { calories: MIN_DAY_KCAL - 1 }), "calcium_mg")).toBe(false);
    expect(isUsableDay(day(500, { calories: MIN_DAY_KCAL }), "calcium_mg")).toBe(true);
    expect(isUsableDay(day(500, { coveragePct: MIN_DAY_COVERAGE_PCT - 1 }), "calcium_mg")).toBe(false);
    expect(isUsableDay(day(null), "calcium_mg")).toBe(false);
    expect(isUsableDay(day(500), "iron_mg")).toBe(false);
  });
});

describe("summarizeNutrient", () => {
  const target = 1000;
  const low = (n: number) => Array.from({ length: n }, () => day(500));
  const fine = (n: number) => Array.from({ length: n }, () => day(900));

  it("is a gap when most usable days are under 67 percent of the target", () => {
    const s = summarizeNutrient([...low(5), ...fine(2)], "calcium_mg", target);
    expect(s).toMatchObject({ status: "gap", usableDays: 7, belowDays: 5 });
    expect(s.avgPct).toBe(Math.round((5 * 50 + 2 * 90) / 7));
  });
  it("is ok when half or fewer are low (exactly half is not 'most')", () => {
    expect(summarizeNutrient([...low(2), ...fine(2)], "calcium_mg", target).status).toBe("ok");
    expect(summarizeNutrient([...low(2), ...fine(3)], "calcium_mg", target).status).toBe("ok");
  });
  it("67 percent exactly is not under the line", () => {
    const edge = Array.from({ length: 5 }, () => day((GAP_BELOW_PCT / 100) * target));
    expect(summarizeNutrient(edge, "calcium_mg", target).status).toBe("ok");
    const under = Array.from({ length: 5 }, () => day((GAP_BELOW_PCT / 100) * target - 1));
    expect(summarizeNutrient(under, "calcium_mg", target).status).toBe("gap");
  });
  it("says nothing with fewer than the minimum usable days", () => {
    const s = summarizeNutrient(low(MIN_USABLE_DAYS - 1), "calcium_mg", target);
    expect(s.status).toBe("not-enough-data");
    expect(s.usableDays).toBe(MIN_USABLE_DAYS - 1);
  });
  it("days with too little detail or too few calories do not count against the person", () => {
    const sparse = Array.from({ length: 10 }, () => day(100, { coveragePct: 20 }));
    const tiny = Array.from({ length: 10 }, () => day(100, { calories: 300 }));
    expect(summarizeNutrient(sparse, "calcium_mg", target).status).toBe("not-enough-data");
    expect(summarizeNutrient(tiny, "calcium_mg", target).status).toBe("not-enough-data");
  });
  it("no target means nothing can be said", () => {
    expect(summarizeNutrient(low(6), "calcium_mg", null).status).toBe("not-enough-data");
    expect(summarizeNutrient(low(6), "calcium_mg", 0).status).toBe("not-enough-data");
  });
  it("counts the days with any food logged", () => {
    const days = [...low(3), { ...day(null), entries: 0, calories: 0 }];
    expect(summarizeNutrient(days, "calcium_mg", target).loggedDays).toBe(3);
  });
});

describe("words and ranking", () => {
  it("the message is kind: no diagnosis, no supplement advice", () => {
    for (const m of [gapMessage("Calcium", 14), gapMessageForCoach("Calcium", "Sam", 14)]) {
      expect(m).toMatch(/low side|looks low/);
      expect(m).not.toMatch(/deficien|diagnos|supplement|take a|should take|disease/i);
    }
    expect(gapMessage("Calcium", 14)).toContain("14 days");
    expect(gapMessageForCoach("Calcium", "Sam", 14)).toContain("Sam");
  });
  it("percentOfTarget", () => {
    expect(percentOfTarget(500, 1000)).toBe(50);
    expect(percentOfTarget(5, 0)).toBe(0);
  });
  it("topGaps keeps only gaps, lowest first, up to the limit", () => {
    const mk = (key: string, status: "gap" | "ok" | "not-enough-data", avgPct: number | null) => ({ key, status, usableDays: 6, belowDays: 5, avgPct, loggedDays: 7 });
    const out = topGaps([mk("a", "gap", 60), mk("b", "ok", 95), mk("c", "gap", 30), mk("d", "gap", 50), mk("e", "gap", 10), mk("f", "not-enough-data", null)], 3);
    expect(out.map((x) => x.key)).toEqual(["e", "c", "d"]);
  });
});
