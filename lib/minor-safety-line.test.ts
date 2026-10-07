import { describe, expect, it } from "vitest";
import { AGE_UNKNOWN_NOTE, minorSafetyLine } from "@/lib/minor-safety";

describe("what the coach is told about the under-18 rule", () => {
  it("no date of birth: age is unknown and the rule could not run, and it says who to ask", () => {
    const line = minorSafetyLine({ ageYears: null, phase: "fat_loss", clientName: "Sam" });
    expect(line).toContain(AGE_UNKNOWN_NOTE);
    expect(line).toContain("Ask Sam to fill in About you");
  });
  it("a minor in a fat-loss phase: the held cut is explained, since it writes no suggestion", () => {
    expect(minorSafetyLine({ ageYears: 16, phase: "fat_loss", clientName: "Sam" })).toBe("Sam is under 18, so no calorie deficit is suggested: a weekly cut is held at their current calories.");
  });
  it("a minor in another phase, and an adult, get nothing to read", () => {
    expect(minorSafetyLine({ ageYears: 16, phase: "hypertrophy", clientName: "Sam" })).toBeNull();
    expect(minorSafetyLine({ ageYears: 16, phase: null, clientName: "Sam" })).toBeNull();
    expect(minorSafetyLine({ ageYears: 18, phase: "fat_loss", clientName: "Sam" })).toBeNull();
    expect(minorSafetyLine({ ageYears: 35, phase: "fat_loss", clientName: "Sam" })).toBeNull();
  });
});
