import { describe, expect, it } from "vitest";
import { shouldPromptStopSuggesting, type SpotterFeedbackEvent } from "./spotter-feedback";

function events(...actions: SpotterFeedbackEvent["action"][]): SpotterFeedbackEvent[] {
  return actions.map((action) => ({ action }));
}

describe("shouldPromptStopSuggesting", () => {
  it("triggers at exactly 3 of the last 5 negative", () => {
    expect(shouldPromptStopSuggesting(events("denied", "denied", "denied", "confirmed", "confirmed"))).toBe(true);
  });

  it("does not trigger at 2 of the last 5 negative", () => {
    expect(shouldPromptStopSuggesting(events("denied", "denied", "confirmed", "confirmed", "confirmed"))).toBe(false);
  });

  it("counts edited as negative alongside denied", () => {
    expect(shouldPromptStopSuggesting(events("edited", "denied", "edited", "confirmed", "confirmed"))).toBe(true);
  });

  it("all 5 negative still triggers", () => {
    expect(shouldPromptStopSuggesting(events("denied", "denied", "denied", "denied", "denied"))).toBe(true);
  });

  it("does not trigger with fewer than the sample size, even if all negative", () => {
    expect(shouldPromptStopSuggesting(events("denied", "denied", "denied", "denied"))).toBe(false);
  });

  it("returns false for zero events", () => {
    expect(shouldPromptStopSuggesting([])).toBe(false);
  });

  it("only considers the first sampleSize events, ignoring older ones", () => {
    // 6 events: newest-first, only the first 5 count.
    const sixEvents = events("confirmed", "confirmed", "confirmed", "denied", "denied", "denied");
    expect(shouldPromptStopSuggesting(sixEvents)).toBe(false);
  });

  it("respects a custom threshold", () => {
    expect(
      shouldPromptStopSuggesting(events("denied", "confirmed"), { sampleSize: 2, majorityThreshold: 1 })
    ).toBe(true);
  });
});
