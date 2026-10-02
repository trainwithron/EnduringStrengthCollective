import { describe, it, expect } from "vitest";
import { computeStrengthTaperWeek, computeHeavySingleWeight } from "./strength-meet-taper";

describe("computeStrengthTaperWeek", () => {
  it("returns null more than 2 weeks out", () => {
    expect(computeStrengthTaperWeek(15)).toBeNull();
    expect(computeStrengthTaperWeek(30)).toBeNull();
  });

  it("returns null once the meet date has passed", () => {
    expect(computeStrengthTaperWeek(-1)).toBeNull();
  });

  it("returns t-1 guidance with a heavy single at the 7-14 day boundary", () => {
    const at14 = computeStrengthTaperWeek(14);
    const at7 = computeStrengthTaperWeek(7);
    expect(at14?.label).toBe("t-1");
    expect(at7?.label).toBe("t-1");
    expect(at14?.heavySinglePct).toBe(92.5);
    expect(at14?.volumeLoadPctRange).toEqual([45, 55]);
  });

  it("returns t-0 (meet week) with no new heavy single at the 0-6 day boundary", () => {
    const at6 = computeStrengthTaperWeek(6);
    const at0 = computeStrengthTaperWeek(0);
    expect(at6?.label).toBe("t-0");
    expect(at0?.label).toBe("t-0");
    expect(at6?.heavySinglePct).toBeNull();
    expect(at0?.heavySinglePct).toBeNull();
    expect(at0?.volumeLoadPctRange).toEqual([30, 50]);
  });
});

describe("computeHeavySingleWeight", () => {
  it("computes and rounds to the nearest 2.5 lbs", () => {
    expect(computeHeavySingleWeight(400, 92.5)).toBe(370); // 370.0 exactly
    expect(computeHeavySingleWeight(315, 92.5)).toBe(292.5); // 291.375 -> rounds to 292.5
  });
});
