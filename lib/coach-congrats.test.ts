import { describe, expect, it } from "vitest";
import { buildCoachCongrats, firstNameOf, SUGGESTED_CONGRATS } from "./coach-congrats";

describe("buildCoachCongrats", () => {
  it("uses the coach's own words and fills in the first name", () => {
    expect(buildCoachCongrats({ athleteFirstName: "Sam", customMessage: "{name}, big win today!" })).toBe("Sam, big win today!");
  });
  it("shows no line until the coach writes one (only the coach's own words speak as the coach)", () => {
    expect(buildCoachCongrats({ athleteFirstName: "Sam", customMessage: "  " })).toBeNull();
    expect(buildCoachCongrats({ athleteFirstName: "Sam", customMessage: null })).toBeNull();
  });
  it("the suggestion is only used once the coach saves it as their own", () => {
    expect(buildCoachCongrats({ athleteFirstName: "Sam", customMessage: SUGGESTED_CONGRATS })).toMatch(/^Sam, you just did something hard/);
  });
  it("copes with a missing name", () => {
    expect(buildCoachCongrats({ athleteFirstName: "", customMessage: "{name}, nice." })).toBe("Hey, nice.");
    expect(firstNameOf("Sam Rivera")).toBe("Sam");
    expect(firstNameOf(null)).toBe("");
  });
});
