import { describe, expect, it } from "vitest";
import { extractNumbers, validateNoHallucinatedNumbers, validateNoNumbers } from "./coach-briefing-numeral-guard";

describe("extractNumbers", () => {
  it("finds every integer and decimal number in a sentence", () => {
    expect(extractNumbers("RPE rose from 7 to 8.5 across 3 sessions")).toEqual([7, 8.5, 3]);
  });

  it("returns an empty array when there are no numbers", () => {
    expect(extractNumbers("Worth checking in on recovery.")).toEqual([]);
  });
});

describe("validateNoHallucinatedNumbers", () => {
  it("passes when every number in the text is in the allowed set", () => {
    const result = validateNoHallucinatedNumbers("RPE rose from 7 to 8.5 across 3 sessions", [7, 8.5, 3]);
    expect(result).toEqual({ valid: true, invalidNumbers: [] });
  });

  it("fails when a number in the text was never in the allowed set (the hallucination case)", () => {
    // The real RPE was 8.5, but the generated text says 9.2 instead.
    const result = validateNoHallucinatedNumbers("RPE rose from 7 to 9.2 across 3 sessions", [7, 8.5, 3]);
    expect(result.valid).toBe(false);
    expect(result.invalidNumbers).toEqual([9.2]);
  });

  it("passes on text with no numbers regardless of the allowed set", () => {
    expect(validateNoHallucinatedNumbers("Worth a check-in.", []).valid).toBe(true);
  });

  it("requires the caller to have already included any derived value (e.g. a rounded %) in allowedValues", () => {
    // 50 is a real derived percentage the caller computed and allowed —
    // the guard doesn't compute it itself, it just checks membership.
    const result = validateNoHallucinatedNumbers("Habit compliance is at 50%", [50]);
    expect(result.valid).toBe(true);
  });
});

describe("validateNoNumbers", () => {
  it("passes for a reflective question with no number in it", () => {
    expect(validateNoNumbers("Worth asking whether something outside training changed.")).toBe(true);
  });

  it("fails for a reflective question that smuggled in a number", () => {
    expect(validateNoNumbers("Worth asking why RPE hit 9 this week.")).toBe(false);
  });
});
