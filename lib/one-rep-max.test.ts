import { describe, it, expect } from "vitest";
import { estimateOneRepMax, percentageTable } from "./one-rep-max";

describe("estimateOneRepMax", () => {
  it("is the same estimate the database keeps as the training max: Epley plus the reps in reserve, a set with no RPE counting as RPE 9", () => {
    // 315 * (1 + (1 + 1)/30) = 336
    expect(estimateOneRepMax(315, 1)).toBe(336);
    // 225 * (1 + (5 + 1)/30) = 270
    expect(estimateOneRepMax(225, 5)).toBe(270);
  });

  it("gives no estimate from a set of more than 8 reps (not reliable)", () => {
    expect(estimateOneRepMax(135, 9)).toBeNull();
    expect(estimateOneRepMax(135, 15)).toBeNull();
    expect(estimateOneRepMax(135, 8)).not.toBeNull();
  });
});

describe("percentageTable", () => {
  it("rounds each percentage to the nearest 5 lbs", () => {
    const table = percentageTable(263);
    expect(table.find((r) => r.pct === 90)?.weight).toBe(235);
    expect(table).toHaveLength(8);
  });
});
