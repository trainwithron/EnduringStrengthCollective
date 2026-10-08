import { describe, expect, it } from "vitest";
import { NUTRIENT_CATALOG } from "@/lib/nutrient-catalog";
import { buildOverview, buildOverviewFromDays, datesEndingOn, NUTRIENT_KEYS, pastDaysFor } from "@/lib/nutrient-view";
import { dayTotals, type LoggedEntry } from "@/lib/nutrient-day";
import { FOCUS_COUNT, focusRows, groupRows } from "@/lib/nutrient-focus";

const TODAY = "2026-10-08";
const entry = (logDate: string, calories: number, nutrients: Record<string, number> | null): LoggedEntry => ({ logDate, status: "quick_log", description: "food", calories, nutrients });
const LOW_FIBER_DAYS = datesEndingOn(TODAY, 12).slice(0, 11).map((d) => entry(d, 2000, { fiber_g: 5, potassium_mg: 3400, calcium_mg: 1000, iron_mg: 9, vitamin_d_mcg: 15, magnesium_mg: 400 }));
const TODAY_ENTRY = entry(TODAY, 900, { fiber_g: 6, potassium_mg: 1200, calcium_mg: 300, iron_mg: 6, vitamin_c_mg: 40, magnesium_mg: 250 });

describe("which nutrients the log shows first", () => {
  it("a nutrient that has been low lately comes first, then the usual ones furthest from the reference today, never more than five, never twice", () => {
    const o = buildOverview({ entries: [...LOW_FIBER_DAYS, TODAY_ENTRY], todayKey: TODAY, age: 30, sex: "male" });
    expect(o.gaps.map((g) => g.nutrient.key)).toContain("fiber_g");
    const rows = focusRows(o);
    expect(rows).toHaveLength(FOCUS_COUNT);
    expect(rows[0].nutrient.key).toBe("fiber_g");
    expect(new Set(rows.map((r) => r.nutrient.key)).size).toBe(rows.length);
    // after the gaps, the reported usual nutrients are ordered by how far from the reference they are today (lowest percent first)
    const rest = rows.slice(o.gaps.length).filter((r) => r.pct != null);
    for (let i = 1; i < rest.length; i++) expect(rest[i].pct as number).toBeGreaterThanOrEqual(rest[i - 1].pct as number);
    expect(rows.every((r) => r.nutrient.role === "target")).toBe(true);
  });
  it("with nothing logged it still shows the usual five, in their normal order, as not reported (never zero)", () => {
    const o = buildOverview({ entries: [], todayKey: TODAY, age: 30, sex: "female" });
    const rows = focusRows(o);
    expect(rows.map((r) => r.nutrient.key)).toEqual(["fiber_g", "potassium_mg", "calcium_mg", "iron_mg", "vitamin_d_mcg"]);
    expect(rows.every((r) => r.total === null)).toBe(true);
  });
  it("the grouped list holds every nutrient exactly once", () => {
    const o = buildOverview({ entries: [TODAY_ENTRY], todayKey: TODAY, age: 30, sex: "male" });
    const groups = groupRows(o);
    expect(groups.map((g) => g.label)).toEqual(["Vitamins", "Minerals", "Fiber, fats and other"]);
    const keys = groups.flatMap((g) => g.rows.map((r) => r.nutrient.key));
    expect(keys.sort()).toEqual(NUTRIENT_CATALOG.map((n) => n.key).sort());
    expect(groups[0].rows.every((r) => r.nutrient.group === "vitamin")).toBe(true);
  });
});

describe("the overview can be rebuilt in the browser from the server's past days plus today's live entries", () => {
  it("gives exactly the same overview as building it from the whole log", () => {
    const all = [...LOW_FIBER_DAYS, TODAY_ENTRY];
    const whole = buildOverview({ entries: all, todayKey: TODAY, age: 30, sex: "male" });
    const past = pastDaysFor(all, TODAY);
    expect(past).toHaveLength(29);
    const rebuilt = buildOverviewFromDays({ days30: [...past, dayTotals(TODAY, [TODAY_ENTRY], NUTRIENT_KEYS)], todayEntries: [TODAY_ENTRY], todayKey: TODAY, age: 30, sex: "male" });
    expect(JSON.stringify(rebuilt)).toBe(JSON.stringify(whole));
  });
  it("logging another food updates today's figures at once, without asking the server", () => {
    const all = [...LOW_FIBER_DAYS, TODAY_ENTRY];
    const past = pastDaysFor(all, TODAY);
    const more = entry(TODAY, 300, { fiber_g: 10, vitamin_c_mg: 60 });
    const before = buildOverviewFromDays({ days30: [...past, dayTotals(TODAY, [TODAY_ENTRY], NUTRIENT_KEYS)], todayEntries: [TODAY_ENTRY], todayKey: TODAY, age: 30, sex: "male" });
    const after = buildOverviewFromDays({ days30: [...past, dayTotals(TODAY, [TODAY_ENTRY, more], NUTRIENT_KEYS)], todayEntries: [TODAY_ENTRY, more], todayKey: TODAY, age: 30, sex: "male" });
    const fiber = (o: typeof before) => o.rows.find((r) => r.nutrient.key === "fiber_g")!.total;
    expect(fiber(before)).toBe(6);
    expect(fiber(after)).toBe(16);
    expect(after.detail.total).toBe(2);
  });
});
