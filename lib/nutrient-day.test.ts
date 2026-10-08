import { describe, expect, it } from "vitest";
import { dayTotals, detailShare, topSources, windowTotals, type LoggedEntry } from "@/lib/nutrient-day";

const e = (over: Partial<LoggedEntry> = {}): LoggedEntry => ({ logDate: "2026-10-08", status: "quick_log", description: "Food", calories: 300, nutrients: null, ...over });

describe("dayTotals: never turns 'not reported' into zero", () => {
  it("sums only the entries that report a nutrient", () => {
    const d = dayTotals("2026-10-08", [e({ nutrients: { calcium_mg: 200 } }), e({ nutrients: { calcium_mg: 150.5 } }), e()], ["calcium_mg"]);
    expect(d.byKey.calcium_mg.total).toBe(350.5);
    expect(d.byKey.calcium_mg.reportingEntries).toBe(2);
    expect(d.byKey.calcium_mg.entries).toBe(3);
  });
  it("is null (not 0) when nothing logged reports the nutrient", () => {
    const d = dayTotals("2026-10-08", [e({ nutrients: { iron_mg: 2 } }), e()], ["calcium_mg"]);
    expect(d.byKey.calcium_mg.total).toBeNull();
    expect(d.byKey.calcium_mg.coveragePct).toBe(0);
  });
  it("a reported zero is a real zero, different from not reported", () => {
    const d = dayTotals("2026-10-08", [e({ nutrients: { sodium_mg: 0 } })], ["sodium_mg"]);
    expect(d.byKey.sodium_mg.total).toBe(0);
  });
  it("coverage is the share of the day's calories that came from entries reporting it", () => {
    const d = dayTotals("2026-10-08", [e({ calories: 600, nutrients: { iron_mg: 3 } }), e({ calories: 200 }), e({ calories: 200 })], ["iron_mg"]);
    expect(d.byKey.iron_mg.coveragePct).toBe(60);
    expect(d.calories).toBe(1000);
  });
  it("with no calories at all, coverage falls back to the share of entries", () => {
    const d = dayTotals("2026-10-08", [e({ calories: null, nutrients: { iron_mg: 3 } }), e({ calories: null, nutrients: { zinc_mg: 1 } })], ["iron_mg"]);
    expect(d.byKey.iron_mg.coveragePct).toBe(50);
  });
  it("skipped entries and other days are left out; text or negative values are ignored", () => {
    const d = dayTotals(
      "2026-10-08",
      [
        e({ status: "skipped", nutrients: { iron_mg: 99 } }),
        e({ logDate: "2026-10-07", nutrients: { iron_mg: 50 } }),
        e({ nutrients: { iron_mg: "lots" as unknown as number } }),
        e({ nutrients: { iron_mg: -4 } }),
        e({ nutrients: { iron_mg: 5 } }),
      ],
      ["iron_mg"]
    );
    expect(d.byKey.iron_mg.total).toBe(5);
    expect(d.entries).toBe(3);
  });
  it("an empty day has no entries and null totals", () => {
    const d = dayTotals("2026-10-08", [], ["iron_mg"]);
    expect(d).toMatchObject({ entries: 0, calories: 0 });
    expect(d.byKey.iron_mg).toMatchObject({ total: null, coveragePct: 0 });
  });
  it("windowTotals gives one entry per date, in order, including empty days", () => {
    const w = windowTotals(["2026-10-06", "2026-10-07", "2026-10-08"], [e({ logDate: "2026-10-08", nutrients: { iron_mg: 1 } })], ["iron_mg"]);
    expect(w.map((d) => d.date)).toEqual(["2026-10-06", "2026-10-07", "2026-10-08"]);
    expect(w.map((d) => d.entries)).toEqual([0, 0, 1]);
  });
});

describe("detailShare", () => {
  it("counts entries that carry any nutrient beyond the four macros", () => {
    const r = detailShare([e({ nutrients: { kcal: 300, protein_g: 10 } }), e({ nutrients: { kcal: 300, fiber_g: 4 } }), e()], "2026-10-08");
    expect(r).toEqual({ detailed: 1, total: 3 });
  });
});

describe("topSources", () => {
  it("ranks foods by how much of the nutrient they gave, merging repeats, from entries that report it", () => {
    const s = topSources(
      [
        e({ description: "Plain yogurt", nutrients: { calcium_mg: 300 } }),
        e({ description: "plain yogurt ", nutrients: { calcium_mg: 100 } }),
        e({ description: "Almonds", nutrients: { calcium_mg: 100 } }),
        e({ description: "Toast" }),
      ],
      "calcium_mg"
    );
    expect(s.map((x) => x.name)).toEqual(["Plain yogurt", "Almonds"]);
    expect(s[0]).toMatchObject({ amount: 400, sharePct: 80 });
  });
  it("is empty when nothing reports it, and respects the limit", () => {
    expect(topSources([e()], "calcium_mg")).toEqual([]);
    const many = Array.from({ length: 8 }, (_, i) => e({ description: `F${i}`, nutrients: { calcium_mg: i + 1 } }));
    expect(topSources(many, "calcium_mg", 3)).toHaveLength(3);
  });
});
