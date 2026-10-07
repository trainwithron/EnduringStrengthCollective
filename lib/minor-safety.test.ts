import { describe, expect, it } from "vitest";
import { holdDeficitForMinor, isUnder18, MINOR_HOLD_NOTE } from "@/lib/minor-safety";

describe("under 18", () => {
  it("is exactly the ages below 18, and an unknown age is not a minor", () => {
    expect(isUnder18(17)).toBe(true);
    expect(isUnder18(18)).toBe(false);
    expect(isUnder18(40)).toBe(false);
    expect(isUnder18(null)).toBe(false);
    expect(isUnder18(undefined)).toBe(false);
  });
});

describe("a minor is never cut", () => {
  const cut = { newCalories: 2000, rationale: "Weight stalled, so calories come down." };
  it("a cut for a 16-year-old is held at the current calories and says why", () => {
    const out = holdDeficitForMinor({ ageYears: 16, currentCalories: 2200, result: cut });
    expect(out.held).toBe(true);
    expect(out.result.newCalories).toBe(2200);
    expect(out.result.rationale).toContain("Weight stalled");
    expect(out.result.rationale).toContain(MINOR_HOLD_NOTE);
  });
  it("an increase or no change for a minor passes through", () => {
    expect(holdDeficitForMinor({ ageYears: 16, currentCalories: 2200, result: { newCalories: 2300, rationale: "up" } }).held).toBe(false);
    expect(holdDeficitForMinor({ ageYears: 16, currentCalories: 2200, result: { newCalories: 2200, rationale: "same" } }).held).toBe(false);
  });
  it("an adult or an unknown age is never held", () => {
    expect(holdDeficitForMinor({ ageYears: 18, currentCalories: 2200, result: cut }).held).toBe(false);
    expect(holdDeficitForMinor({ ageYears: null, currentCalories: 2200, result: cut }).result.newCalories).toBe(2000);
  });
  it("other fields of the result are kept", () => {
    const out = holdDeficitForMinor({ ageYears: 15, currentCalories: 2200, result: { ...cut, consecutiveSurplusSpikes: 2 } });
    expect(out.result.consecutiveSurplusSpikes).toBe(2);
  });
});
