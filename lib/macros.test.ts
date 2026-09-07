import { describe, it, expect } from "vitest";
import { estimateProteinFromBodyWeight, fillCarbsAndFat } from "./macros";

describe("estimateProteinFromBodyWeight", () => {
  it("uses the 1g-per-lb rule of thumb", () => {
    expect(estimateProteinFromBodyWeight(180)).toBe(180);
  });
});

describe("fillCarbsAndFat", () => {
  it("splits remaining calories 70/30 (carb/fat) on a high-carb day", () => {
    // 2400 cal, 180g protein -> 720 protein cal, 1680 remaining.
    const result = fillCarbsAndFat(2400, 180, "high");
    expect(result).toEqual({ carbsG: 294, fatG: 56 });
  });

  it("splits remaining calories 30/70 (carb/fat) on a low-carb day", () => {
    const result = fillCarbsAndFat(2400, 180, "low");
    expect(result).toEqual({ carbsG: 126, fatG: 131 });
  });

  it("returns null when there's nothing to split", () => {
    expect(fillCarbsAndFat(0, 180, "high")).toBeNull();
    expect(fillCarbsAndFat(2400, 0, "high")).toBeNull();
    // Protein alone already meets/exceeds calories — nothing left over.
    expect(fillCarbsAndFat(400, 180, "high")).toBeNull();
  });
});
