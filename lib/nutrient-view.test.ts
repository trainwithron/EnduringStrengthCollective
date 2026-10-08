import { describe, expect, it } from "vitest";
import { buildDetail, buildOverview, completenessLine, datesEndingOn, safeIdeas } from "@/lib/nutrient-view";
import { catalogNutrient } from "@/lib/nutrient-catalog";
import type { LoggedEntry } from "@/lib/nutrient-day";

const TODAY = "2026-10-08";
const entry = (date: string, nutrients: Record<string, number> | null, over: Partial<LoggedEntry> = {}): LoggedEntry => ({ logDate: date, status: "quick_log", description: "Food", calories: 700, nutrients, ...over });

// four meals a day, each with the given calcium, so a day is "real" (2,800 kcal) and fully reported
const richDay = (date: string, calcium: number): LoggedEntry[] => Array.from({ length: 4 }, () => entry(date, { calcium_mg: calcium / 4 }));

describe("datesEndingOn", () => {
  it("gives the last n dates, oldest first, across month and year ends", () => {
    expect(datesEndingOn("2026-10-08", 3)).toEqual(["2026-10-06", "2026-10-07", "2026-10-08"]);
    expect(datesEndingOn("2026-03-02", 4)).toEqual(["2026-02-27", "2026-02-28", "2026-03-01", "2026-03-02"]);
    expect(datesEndingOn("2027-01-02", 3)).toEqual(["2026-12-31", "2027-01-01", "2027-01-02"]);
    expect(datesEndingOn("2026-10-08", 30)).toHaveLength(30);
  });
});

describe("buildOverview", () => {
  it("shows today's total against the person's own reference intake", () => {
    const o = buildOverview({ entries: richDay(TODAY, 500), todayKey: TODAY, age: 30, sex: "male" });
    const calcium = o.rows.find((r) => r.nutrient.key === "calcium_mg")!;
    expect(calcium.total).toBe(500);
    expect(calcium.pct).toBe(50);
    expect(calcium.ref?.target).toBe(1000);
    expect(calcium.coveragePct).toBe(100);
    expect(o.assumption).toBeNull();
  });
  it("a nutrient nothing reports is null, never zero, with no percent", () => {
    const o = buildOverview({ entries: richDay(TODAY, 500), todayKey: TODAY, age: 30, sex: "male" });
    const iron = o.rows.find((r) => r.nutrient.key === "iron_mg")!;
    expect(iron.total).toBeNull();
    expect(iron.pct).toBeNull();
    expect(iron.seenRecently).toBe(false);
  });
  it("names an assumption when age or sex is unknown", () => {
    const o = buildOverview({ entries: [], todayKey: TODAY, age: null, sex: null });
    expect(o.assumption).toMatch(/adult average/);
    const known = buildOverview({ entries: [], todayKey: TODAY, age: 30, sex: "female" });
    expect(known.assumption).toBeNull();
  });
  it("finds a gap when most counted days are well under the reference", () => {
    const entries = datesEndingOn(TODAY, 6).flatMap((d) => richDay(d, 400));
    const o = buildOverview({ entries, todayKey: TODAY, age: 30, sex: "male" });
    expect(o.gaps.map((g) => g.nutrient.key)).toContain("calcium_mg");
    expect(o.gaps.find((g) => g.nutrient.key === "calcium_mg")!.summary.status).toBe("gap");
  });
  it("finds no gap when intake is on target, and none when there is not enough to go on", () => {
    const fine = buildOverview({ entries: datesEndingOn(TODAY, 6).flatMap((d) => richDay(d, 1000)), todayKey: TODAY, age: 30, sex: "male" });
    expect(fine.gaps.find((g) => g.nutrient.key === "calcium_mg")).toBeUndefined();
    const thin = buildOverview({ entries: richDay(TODAY, 100), todayKey: TODAY, age: 30, sex: "male" });
    expect(thin.gaps).toHaveLength(0);
  });
  it("sodium and saturated fat never become gaps (a limit and an information-only row)", () => {
    const entries = datesEndingOn(TODAY, 6).flatMap((d) => Array.from({ length: 4 }, () => entry(d, { sodium_mg: 10, sat_fat_g: 0.1 })));
    const o = buildOverview({ entries, todayKey: TODAY, age: 30, sex: "male" });
    expect(o.gaps).toHaveLength(0);
    const sodium = o.rows.find((r) => r.nutrient.key === "sodium_mg")!;
    expect(sodium.pct).toBeNull();
    expect(sodium.total).toBe(40);
    expect(sodium.ref?.ul).toBe(2300);
  });
  it("counts how many of today's foods carry detail", () => {
    const o = buildOverview({ entries: [entry(TODAY, { calcium_mg: 100 }), entry(TODAY, null)], todayKey: TODAY, age: 30, sex: "male" });
    expect(o.detail).toEqual({ detailed: 1, total: 2 });
    expect(o.todayEntries).toBe(2);
  });
  it("a person outside the table gets amounts but no percent", () => {
    const o = buildOverview({ entries: richDay(TODAY, 500), todayKey: TODAY, age: 0, sex: "male" });
    const calcium = o.rows.find((r) => r.nutrient.key === "calcium_mg")!;
    expect(calcium.total).toBe(500);
    expect(calcium.ref).toBeNull();
    expect(calcium.pct).toBeNull();
  });
});

describe("safeIdeas: foods that could help, checked against the person's rules", () => {
  const vitD = catalogNutrient("vitamin_d_mcg")!;
  it("removes foods that break an allergy", () => {
    const r = safeIdeas(vitD, { allergies: ["fish"], dietType: "omnivore" });
    expect(r.foods).not.toContain("Salmon");
    expect(r.foods).not.toContain("Trout");
    expect(r.foods).toContain("Eggs");
  });
  it("a vegan is not offered eggs or dairy, and an egg allergy removes eggs", () => {
    const vegan = safeIdeas(vitD, { dietType: "vegan" }).foods;
    expect(vegan).not.toContain("Eggs");
    expect(vegan).not.toContain("Salmon");
    expect(vegan).not.toContain("Fortified milk");
    expect(safeIdeas(vitD, { allergies: ["egg"] }).foods).not.toContain("Eggs");
  });
  it("dislikes and intolerances are respected too", () => {
    expect(safeIdeas(catalogNutrient("calcium_mg")!, { intolerances: ["dairy"] }).foods).not.toContain("Plain yogurt");
    expect(safeIdeas(catalogNutrient("fiber_g")!, { dislikes: ["lentils"] }).foods).not.toContain("Lentils");
  });
  it("fails closed: with no rules to check against nothing is suggested", () => {
    expect(safeIdeas(vitD, null)).toEqual({ foods: [], hiddenReason: "no-rules" });
  });
  it("is not offered for keto, paleo or carnivore", () => {
    for (const d of ["keto", "paleo", "carnivore"]) expect(safeIdeas(vitD, { dietType: d })).toEqual({ foods: [], hiddenReason: "diet" });
  });
  it("sodium and saturated fat have no ideas", () => {
    expect(safeIdeas(catalogNutrient("sodium_mg")!, { dietType: "omnivore" })).toEqual({ foods: [], hiddenReason: null });
  });
  it("every nutrient's list keeps at least one food for a person with a peanut allergy, so a list is never emptied by one allergy", () => {
    for (const n of ["fiber_g", "potassium_mg", "calcium_mg", "iron_mg", "magnesium_mg", "zinc_mg", "vitamin_d_mcg", "b12_mcg", "vitamin_c_mg", "folate_mcg"]) {
      expect(safeIdeas(catalogNutrient(n)!, { allergies: ["peanut"] }).foods.length, n).toBeGreaterThan(0);
    }
  });
});

describe("buildDetail", () => {
  it("builds 7- and 30-day bars with percent of the reference, only counting real days", () => {
    const entries = [...richDay(TODAY, 800), ...richDay("2026-10-07", 400), ...[entry("2026-10-06", { calcium_mg: 50 })]];
    const d = buildDetail({ key: "calcium_mg", entries, todayKey: TODAY, age: 30, sex: "male", rules: { allergies: [] } })!;
    expect(d.last7).toHaveLength(7);
    expect(d.last30).toHaveLength(30);
    expect(d.today).toMatchObject({ date: TODAY, total: 800, pct: 80, counts: true });
    expect(d.last7[5]).toMatchObject({ date: "2026-10-07", pct: 40, counts: true });
    // one 700-kcal entry is not a real day of eating: it shows but does not count
    expect(d.last7[4]).toMatchObject({ date: "2026-10-06", total: 50, counts: false });
    expect(d.avg7).toBe(60);
    expect(d.target).toBe(1000);
  });
  it("lists where it came from and ideas that fit the person", () => {
    const entries = [entry(TODAY, { calcium_mg: 300 }, { description: "Plain yogurt" }), entry(TODAY, { calcium_mg: 100 }, { description: "Almonds" })];
    const d = buildDetail({ key: "calcium_mg", entries, todayKey: TODAY, age: 30, sex: "male", rules: { intolerances: ["dairy"] } })!;
    expect(d.sources.map((s) => s.name)).toEqual(["Plain yogurt", "Almonds"]);
    expect(d.ideas.foods).not.toContain("Milk");
  });
  it("returns null for a nutrient that is not in the catalog", () => {
    expect(buildDetail({ key: "nope", entries: [], todayKey: TODAY, age: 30, sex: "male", rules: null })).toBeNull();
  });
  it("sodium has no target but keeps its limit level", () => {
    const d = buildDetail({ key: "sodium_mg", entries: [], todayKey: TODAY, age: 30, sex: "male", rules: null })!;
    expect(d.target).toBeNull();
    expect(d.ref?.ul).toBe(2300);
  });
});

describe("completenessLine", () => {
  it("says how much of the day is counted", () => {
    expect(completenessLine(100, 3)).toMatch(/everything/);
    expect(completenessLine(0, 3)).toMatch(/None of the foods/);
    expect(completenessLine(62.4, 3)).toContain("62%");
    expect(completenessLine(50, 0)).toBeNull();
  });
});
