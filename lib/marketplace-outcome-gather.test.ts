import { describe, it, expect } from "vitest";
import { computeFullSpanWeightLossSuccess } from "./marketplace-outcome-gather";

describe("computeFullSpanWeightLossSuccess", () => {
  it("returns null with fewer than 2 logs — not enough real data to call it", () => {
    expect(computeFullSpanWeightLossSuccess([])).toBeNull();
    expect(computeFullSpanWeightLossSuccess([{ logged_date: "2026-01-01", weight: 200 }])).toBeNull();
  });

  it("returns true for a real net downward trend across the full span", () => {
    const logs = [
      { logged_date: "2026-01-01", weight: 210 },
      { logged_date: "2026-01-08", weight: 209 },
      { logged_date: "2026-03-01", weight: 195 },
      { logged_date: "2026-03-08", weight: 194 },
    ];
    expect(computeFullSpanWeightLossSuccess(logs)).toBe(true);
  });

  it("returns false when the trend is flat or upward, not a fabricated success", () => {
    const logs = [
      { logged_date: "2026-01-01", weight: 190 },
      { logged_date: "2026-01-08", weight: 191 },
      { logged_date: "2026-03-01", weight: 196 },
      { logged_date: "2026-03-08", weight: 197 },
    ];
    expect(computeFullSpanWeightLossSuccess(logs)).toBe(false);
  });

  it("is not fooled by one noisy week at either end — uses a real smoothing window", () => {
    // A single low outlier at the very start shouldn't flip the verdict
    // for a genuinely flat/upward real trend across the rest of the span.
    const logs = [
      { logged_date: "2026-01-01", weight: 180 }, // one-off noisy low reading
      { logged_date: "2026-01-08", weight: 200 },
      { logged_date: "2026-01-15", weight: 201 },
      { logged_date: "2026-03-01", weight: 202 },
      { logged_date: "2026-03-08", weight: 203 },
      { logged_date: "2026-03-15", weight: 204 },
    ];
    expect(computeFullSpanWeightLossSuccess(logs)).toBe(false);
  });

  it("handles out-of-order input by sorting on real logged_date first", () => {
    const logs = [
      { logged_date: "2026-03-08", weight: 190 },
      { logged_date: "2026-01-01", weight: 210 },
      { logged_date: "2026-01-08", weight: 209 },
      { logged_date: "2026-03-01", weight: 191 },
    ];
    expect(computeFullSpanWeightLossSuccess(logs)).toBe(true);
  });
});
