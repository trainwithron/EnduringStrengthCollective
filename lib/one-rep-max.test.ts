import { describe, it, expect } from "vitest";
import { estimateOneRepMax, percentageTable } from "./one-rep-max";

describe("estimateOneRepMax", () => {
  it("passes weight straight through for a single rep", () => {
    expect(estimateOneRepMax(315, 1)).toBe(315);
  });

  it("applies the Epley formula for multiple reps", () => {
    // 225 * (1 + 5/30) = 262.5 -> rounds to 263
    expect(estimateOneRepMax(225, 5)).toBe(263);
  });
});

describe("percentageTable", () => {
  it("rounds each percentage to the nearest 5 lbs", () => {
    const table = percentageTable(263);
    expect(table.find((r) => r.pct === 90)?.weight).toBe(235);
    expect(table).toHaveLength(8);
  });
});
