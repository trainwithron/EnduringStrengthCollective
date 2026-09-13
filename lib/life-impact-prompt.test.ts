import { describe, expect, it } from "vitest";
import { shouldShowLifeImpactPrompt, pickLifeImpactPrompt, LIFE_IMPACT_PROMPTS } from "./life-impact-prompt";

describe("shouldShowLifeImpactPrompt", () => {
  it("is true when the athlete has never answered one before", () => {
    expect(shouldShowLifeImpactPrompt(null, new Date(2026, 0, 15))).toBe(true);
  });

  it("is false just under the minimum window", () => {
    const last = new Date(2026, 0, 1);
    const now = new Date(2026, 0, 1 + 29);
    expect(shouldShowLifeImpactPrompt(last, now)).toBe(false);
  });

  it("is true exactly at the minimum window", () => {
    const last = new Date(2026, 0, 1);
    const now = new Date(2026, 0, 1 + 30);
    expect(shouldShowLifeImpactPrompt(last, now)).toBe(true);
  });

  it("respects a custom window", () => {
    const last = new Date(2026, 0, 1);
    const now = new Date(2026, 0, 8);
    expect(shouldShowLifeImpactPrompt(last, now, 7)).toBe(true);
    expect(shouldShowLifeImpactPrompt(last, now, 14)).toBe(false);
  });
});

describe("pickLifeImpactPrompt", () => {
  it("always returns one of the real prompt bank entries", () => {
    const picked = pickLifeImpactPrompt("athlete-1", "2026-01-15");
    expect(LIFE_IMPACT_PROMPTS).toContain(picked);
  });

  it("is stable for the same athlete and day", () => {
    const first = pickLifeImpactPrompt("athlete-1", "2026-01-15");
    const second = pickLifeImpactPrompt("athlete-1", "2026-01-15");
    expect(first).toBe(second);
  });

  it("varies across different athletes or days (real rotation, not a constant)", () => {
    const picks = new Set([
      pickLifeImpactPrompt("athlete-1", "2026-01-15"),
      pickLifeImpactPrompt("athlete-2", "2026-01-15"),
      pickLifeImpactPrompt("athlete-1", "2026-02-20"),
      pickLifeImpactPrompt("athlete-3", "2026-03-10"),
    ]);
    expect(picks.size).toBeGreaterThan(1);
  });
});
