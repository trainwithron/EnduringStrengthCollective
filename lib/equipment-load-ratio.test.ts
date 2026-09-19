import { describe, it, expect } from "vitest";
import {
  collapseToDailyMax,
  computeVariantRatioSamples,
  medianRatio,
  convertWeightAcrossVariants,
  MIN_SAMPLE_COUNT_FOR_RATIO,
} from "./equipment-load-ratio";

describe("collapseToDailyMax", () => {
  it("keeps only the max weight per calendar day", () => {
    const result = collapseToDailyMax([
      { sessionDate: "2026-09-01", weight: 100 },
      { sessionDate: "2026-09-01", weight: 120 },
      { sessionDate: "2026-09-01", weight: 90 },
      { sessionDate: "2026-09-03", weight: 110 },
    ]);
    expect(result).toEqual(
      expect.arrayContaining([
        { sessionDate: "2026-09-01", weight: 120 },
        { sessionDate: "2026-09-03", weight: 110 },
      ])
    );
    expect(result).toHaveLength(2);
  });

  it("returns an empty array for no entries", () => {
    expect(collapseToDailyMax([])).toEqual([]);
  });
});

describe("computeVariantRatioSamples", () => {
  it("pairs same-day entries and computes B/A ratios", () => {
    const historyA = [
      { sessionDate: "2026-09-01", weight: 100 },
      { sessionDate: "2026-09-08", weight: 105 },
    ];
    const historyB = [
      { sessionDate: "2026-09-01", weight: 80 },
      { sessionDate: "2026-09-08", weight: 84 },
    ];
    const ratios = computeVariantRatioSamples(historyA, historyB);
    expect(ratios).toEqual([0.8, 0.8]);
  });

  it("skips a B-side day with no matching A-side entry", () => {
    const historyA = [{ sessionDate: "2026-09-01", weight: 100 }];
    const historyB = [
      { sessionDate: "2026-09-01", weight: 80 },
      { sessionDate: "2026-09-15", weight: 90 }, // no matching A day
    ];
    expect(computeVariantRatioSamples(historyA, historyB)).toEqual([0.8]);
  });

  it("returns an empty list when there's no date overlap at all", () => {
    const historyA = [{ sessionDate: "2026-09-01", weight: 100 }];
    const historyB = [{ sessionDate: "2026-09-02", weight: 80 }];
    expect(computeVariantRatioSamples(historyA, historyB)).toEqual([]);
  });

  it("collapses multiple same-day sets to daily max before pairing", () => {
    const historyA = [
      { sessionDate: "2026-09-01", weight: 90 },
      { sessionDate: "2026-09-01", weight: 100 },
    ];
    const historyB = [
      { sessionDate: "2026-09-01", weight: 70 },
      { sessionDate: "2026-09-01", weight: 80 },
    ];
    expect(computeVariantRatioSamples(historyA, historyB)).toEqual([0.8]);
  });
});

describe("medianRatio", () => {
  it("returns null for an empty list", () => {
    expect(medianRatio([])).toBeNull();
  });

  it("returns the middle value for an odd-length list", () => {
    expect(medianRatio([0.7, 0.8, 0.9])).toBe(0.8);
  });

  it("averages the two middle values for an even-length list", () => {
    expect(medianRatio([0.7, 0.8, 0.9, 1.0])).toBeCloseTo(0.85);
  });

  it("is robust to one outlier pairing", () => {
    // A noisy one-off (maybe a bad log) shouldn't drag the whole estimate.
    expect(medianRatio([0.78, 0.8, 0.82, 1.5])).toBeCloseTo(0.81);
  });
});

describe("MIN_SAMPLE_COUNT_FOR_RATIO", () => {
  it("requires more than one coincidental pairing before trusting a ratio", () => {
    expect(MIN_SAMPLE_COUNT_FOR_RATIO).toBeGreaterThan(1);
  });
});

describe("convertWeightAcrossVariants", () => {
  const row = { exerciseNameA: "Barbell Leg Press", exerciseNameB: "Hammer Strength Leg Press", ratio: 1.6 };

  it("converts A's weight to B by multiplying by the ratio", () => {
    expect(convertWeightAcrossVariants(200, "Barbell Leg Press", "Hammer Strength Leg Press", row)).toBe(320);
  });

  it("converts B's weight back to A by dividing by the ratio", () => {
    expect(convertWeightAcrossVariants(320, "Hammer Strength Leg Press", "Barbell Leg Press", row)).toBe(200);
  });

  it("returns null when neither name matches the stored pair", () => {
    expect(convertWeightAcrossVariants(200, "Squat", "Deadlift", row)).toBeNull();
  });

  it("rounds to the nearest whole pound", () => {
    const oddRow = { exerciseNameA: "A", exerciseNameB: "B", ratio: 1.333 };
    expect(convertWeightAcrossVariants(150, "A", "B", oddRow)).toBe(200);
  });
});
