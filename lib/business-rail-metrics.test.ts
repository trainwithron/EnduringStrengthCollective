import { describe, expect, it } from "vitest";
import { resolveTopBusinessMetrics, DEFAULT_BUSINESS_METRICS } from "./business-rail-metrics";

describe("resolveTopBusinessMetrics", () => {
  it("returns the default 3 when nothing is saved", () => {
    expect(resolveTopBusinessMetrics([])).toEqual(DEFAULT_BUSINESS_METRICS);
  });

  it("respects a valid saved pick of exactly 3", () => {
    expect(resolveTopBusinessMetrics(["roster_size", "engagement_pct", "income_month"])).toEqual([
      "roster_size",
      "engagement_pct",
      "income_month",
    ]);
  });

  it("fills a short saved pick with defaults not already picked", () => {
    expect(resolveTopBusinessMetrics(["roster_size"])).toEqual(["roster_size", "mrr", "new_clients_month"]);
  });

  it("drops unknown/stale keys and backfills", () => {
    expect(resolveTopBusinessMetrics(["ghost_metric", "mrr"])).toEqual(["mrr", "new_clients_month", "active_paying"]);
  });

  it("drops duplicate keys in the saved list", () => {
    expect(resolveTopBusinessMetrics(["mrr", "mrr", "roster_size"])).toEqual(["mrr", "roster_size", "new_clients_month"]);
  });

  it("truncates a saved pick longer than 3", () => {
    expect(
      resolveTopBusinessMetrics(["mrr", "roster_size", "engagement_pct", "income_month"])
    ).toEqual(["mrr", "roster_size", "engagement_pct"]);
  });
});
