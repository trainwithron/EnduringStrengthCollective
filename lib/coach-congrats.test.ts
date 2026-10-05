import { describe, expect, it } from "vitest";
import { buildCoachCongrats, firstNameOf } from "./coach-congrats";

describe("buildCoachCongrats", () => {
  it("uses the coach's own words and fills in the first name", () => {
    expect(buildCoachCongrats({ athleteFirstName: "Sam", customMessage: "{name}, big win today!", hadPr: false })).toBe(
      "Sam, big win today!"
    );
  });
  it("falls back to a warm default, with a PR variant", () => {
    expect(buildCoachCongrats({ athleteFirstName: "Sam", customMessage: "  ", hadPr: false })).toMatch(/^Sam, you just did something hard/);
    expect(buildCoachCongrats({ athleteFirstName: "Sam", customMessage: null, hadPr: true })).toMatch(/personal best/);
  });
  it("copes with a missing name", () => {
    expect(buildCoachCongrats({ athleteFirstName: "", customMessage: null, hadPr: false })).toMatch(/^Hey, /);
    expect(firstNameOf("Sam Rivera")).toBe("Sam");
    expect(firstNameOf(null)).toBe("");
  });
});
