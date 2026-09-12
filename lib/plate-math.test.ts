import { describe, it, expect } from "vitest";
import { computePlateBreakdown, isPlateMathMilestone } from "./plate-math";

describe("computePlateBreakdown", () => {
  it("computes the classic 225 lb breakdown (two 45s per side)", () => {
    // 225 = 45 (bar) + 2 x 90 (90 per side => two 45 lb plates per side)
    const result = computePlateBreakdown(225);
    expect(result).toEqual({ barWeight: 45, totalWeight: 225, perSide: [45, 45], exact: true });
  });

  it("computes a two-plate-per-side combination, largest first", () => {
    // 315 = 45 + 2 x 135 => 90 + 45 per side = one 45 + one 45? recompute: 135 per side needs 45+45+35+10
    const result = computePlateBreakdown(315);
    expect(result.exact).toBe(true);
    expect(result.perSide.reduce((sum, p) => sum + p, 0)).toBe(135);
    // Descending order
    expect([...result.perSide]).toEqual([...result.perSide].sort((a, b) => b - a));
  });

  it("returns exact:false and no plates when the weight is below the bar", () => {
    const result = computePlateBreakdown(35);
    expect(result.exact).toBe(false);
    expect(result.perSide).toEqual([]);
  });

  it("returns exact:false for a weight that can't be built from standard denominations", () => {
    // 47 lbs => 1 lb per side, no standard plate that small
    const result = computePlateBreakdown(47);
    expect(result.exact).toBe(false);
  });

  it("handles bar weight alone (no plates)", () => {
    const result = computePlateBreakdown(45);
    expect(result).toEqual({ barWeight: 45, totalWeight: 45, perSide: [], exact: true });
  });

  it("supports a custom bar weight", () => {
    const result = computePlateBreakdown(155, 35);
    // (155 - 35) / 2 = 60 per side => 45 + 10 + 5
    expect(result.exact).toBe(true);
    expect(result.perSide).toEqual([45, 10, 5]);
  });
});

describe("isPlateMathMilestone", () => {
  it("recognizes the classic bar-math benchmarks", () => {
    expect(isPlateMathMilestone(135)).toBe(true);
    expect(isPlateMathMilestone(225)).toBe(true);
    expect(isPlateMathMilestone(315)).toBe(true);
    expect(isPlateMathMilestone(405)).toBe(true);
  });

  it("does not flag a non-milestone weight, even one with an exact plate breakdown", () => {
    expect(isPlateMathMilestone(185)).toBe(false);
    expect(isPlateMathMilestone(275)).toBe(false);
  });
});
