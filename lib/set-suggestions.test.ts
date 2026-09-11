import { describe, it, expect } from "vitest";
import { findCorrelatingWeightSuggestion, resolveWeightSuggestion } from "./set-suggestions";

describe("findCorrelatingWeightSuggestion", () => {
  // The exact worked example: Wk1=5 reps/100lbs, Wk2=8/90, Wk3=12/80,
  // Wk4=5 reps again. Week 4's suggestion must reach past Wk2/Wk3 to
  // Wk1's real logged weight, not just "the last session."
  const undulatingHistory = [
    { loggedAt: "2026-01-01", weight: 100, targetReps: 5, targetRpe: null, targetRir: null },
    { loggedAt: "2026-01-08", weight: 90, targetReps: 8, targetRpe: null, targetRir: null },
    { loggedAt: "2026-01-15", weight: 80, targetReps: 12, targetRpe: null, targetRir: null },
  ];

  it("reaches back past differently-repped weeks to the last matching-rep-target session", () => {
    expect(findCorrelatingWeightSuggestion(undulatingHistory, 5)).toBe(100);
  });

  it("is not just 'the last session' — a different rep target returns a different match", () => {
    expect(findCorrelatingWeightSuggestion(undulatingHistory, 8)).toBe(90);
    expect(findCorrelatingWeightSuggestion(undulatingHistory, 12)).toBe(80);
  });

  it("returns null when nothing in history matches this rep target", () => {
    expect(findCorrelatingWeightSuggestion(undulatingHistory, 3)).toBeNull();
  });

  it("returns null with no target reps to match against", () => {
    expect(findCorrelatingWeightSuggestion(undulatingHistory, null)).toBeNull();
  });

  it("prefers a match with the same RPE/RIR target over a rep-only match", () => {
    const history = [
      { loggedAt: "2026-01-01", weight: 100, targetReps: 5, targetRpe: 7, targetRir: null },
      { loggedAt: "2026-01-08", weight: 110, targetReps: 5, targetRpe: 9, targetRir: null },
    ];
    expect(findCorrelatingWeightSuggestion(history, 5, 7)).toBe(100);
    expect(findCorrelatingWeightSuggestion(history, 5, 9)).toBe(110);
  });

  it("falls back to a rep-only match when no RPE/RIR match exists, rather than returning null", () => {
    const history = [{ loggedAt: "2026-01-01", weight: 100, targetReps: 5, targetRpe: 6, targetRir: null }];
    expect(findCorrelatingWeightSuggestion(history, 5, 8)).toBe(100);
  });

  it("picks the most recent match when multiple sessions share the same rep target", () => {
    const history = [
      { loggedAt: "2026-01-01", weight: 90, targetReps: 5, targetRpe: null, targetRir: null },
      { loggedAt: "2026-02-01", weight: 105, targetReps: 5, targetRpe: null, targetRir: null },
    ];
    expect(findCorrelatingWeightSuggestion(history, 5)).toBe(105);
  });
});

describe("resolveWeightSuggestion", () => {
  it("prefers an explicit target that represents real forward progress over history (linear progression)", () => {
    // 100 -> 105 -> 110: after 100 was logged, the linear model's next
    // computed target (105) is the goal, not a repeat of the 100 carried
    // over from history.
    expect(resolveWeightSuggestion(100, 105)).toBe(105);
  });

  it("prefers real logged history over an explicit target that is lower or equal (a generator's guess)", () => {
    expect(resolveWeightSuggestion(130, 120)).toBe(130);
    expect(resolveWeightSuggestion(130, 130)).toBe(130);
  });

  it("falls back to whichever one exists when the other is absent", () => {
    expect(resolveWeightSuggestion(null, 105)).toBe(105);
    expect(resolveWeightSuggestion(100, null)).toBe(100);
    expect(resolveWeightSuggestion(null, null)).toBeNull();
  });
});
