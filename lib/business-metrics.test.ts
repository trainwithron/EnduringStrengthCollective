import { describe, it, expect } from "vitest";
import {
  computeEstimatedMRR,
  computeEngagement,
  computeMonthlyGrowth,
  computeRealIncomeThisMonth,
  computeRealMRR,
  computeActivePayingClients,
} from "./business-metrics";

describe("computeEstimatedMRR", () => {
  it("sums only clients with a rate set, ignoring nulls", () => {
    expect(
      computeEstimatedMRR([{ monthlyRate: 150 }, { monthlyRate: null }, { monthlyRate: 200 }])
    ).toBe(350);
  });

  it("returns 0 for an empty roster or no rates set", () => {
    expect(computeEstimatedMRR([])).toBe(0);
    expect(computeEstimatedMRR([{ monthlyRate: null }])).toBe(0);
  });
});

describe("computeEngagement", () => {
  it("counts a client active if their last log falls within the window", () => {
    const result = computeEngagement(
      [{ lastActiveDateKey: "2026-09-01" }, { lastActiveDateKey: "2026-08-01" }],
      "2026-09-07",
      14
    );
    expect(result.activeCount).toBe(1);
    expect(result.totalCount).toBe(2);
    expect(result.pct).toBe(50);
  });

  it("treats a client who has never logged as inactive", () => {
    const result = computeEngagement([{ lastActiveDateKey: null }], "2026-09-07", 14);
    expect(result.activeCount).toBe(0);
    expect(result.pct).toBe(0);
  });

  it("is inclusive at exactly the window boundary", () => {
    // 2026-08-24 is exactly 14 days before 2026-09-07.
    const result = computeEngagement([{ lastActiveDateKey: "2026-08-24" }], "2026-09-07", 14);
    expect(result.activeCount).toBe(1);
  });

  it("excludes a log one day past the window", () => {
    const result = computeEngagement([{ lastActiveDateKey: "2026-08-23" }], "2026-09-07", 14);
    expect(result.activeCount).toBe(0);
  });

  it("returns 0% for an empty roster rather than dividing by zero", () => {
    const result = computeEngagement([], "2026-09-07", 14);
    expect(result.pct).toBe(0);
  });
});

describe("computeRealIncomeThisMonth", () => {
  it("sums only events dated within the given month", () => {
    const total = computeRealIncomeThisMonth(
      [
        { amountCents: 10000, createdAtDateKey: "2026-09-05" },
        { amountCents: 5000, createdAtDateKey: "2026-09-20" },
        { amountCents: 9999, createdAtDateKey: "2026-08-31" },
      ],
      "2026-09"
    );
    expect(total).toBe(150);
  });

  it("returns 0 for no events this month", () => {
    expect(computeRealIncomeThisMonth([], "2026-09")).toBe(0);
  });
});

describe("computeRealMRR", () => {
  it("sums only active subscriptions, ignoring past_due/canceled/incomplete", () => {
    const mrr = computeRealMRR([
      { priceCents: 9500, status: "active" },
      { priceCents: 12000, status: "active" },
      { priceCents: 8000, status: "past_due" },
      { priceCents: 7000, status: "canceled" },
    ]);
    expect(mrr).toBe(215);
  });

  it("treats a null priceCents as 0 rather than throwing", () => {
    expect(computeRealMRR([{ priceCents: null, status: "active" }])).toBe(0);
  });
});

describe("computeActivePayingClients", () => {
  it("counts unique athletes with an active purchase or subscription", () => {
    const count = computeActivePayingClients([
      { athleteId: "a", hasActivePurchaseOrSub: true },
      { athleteId: "a", hasActivePurchaseOrSub: true }, // duplicate row, still one client
      { athleteId: "b", hasActivePurchaseOrSub: false },
      { athleteId: "c", hasActivePurchaseOrSub: true },
    ]);
    expect(count).toBe(2);
  });

  it("returns 0 when nobody has paid", () => {
    expect(computeActivePayingClients([{ athleteId: "a", hasActivePurchaseOrSub: false }])).toBe(0);
  });
});

describe("computeMonthlyGrowth", () => {
  it("buckets joined dates into the correct month, oldest to newest", () => {
    const joined = ["2026-07-15", "2026-08-01", "2026-08-20", "2026-09-05"];
    const buckets = computeMonthlyGrowth(joined, "2026-09-07", 3);
    expect(buckets.map((b) => b.count)).toEqual([1, 2, 1]);
    expect(buckets[0].monthLabel).toBe("Jul 2026");
    expect(buckets[2].monthLabel).toBe("Sep 2026");
  });

  it("returns a zero-filled bucket for a month with no signups", () => {
    const buckets = computeMonthlyGrowth(["2026-09-05"], "2026-09-07", 2);
    expect(buckets.map((b) => b.count)).toEqual([0, 1]);
  });
});
