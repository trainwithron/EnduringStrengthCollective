import { describe, it, expect } from "vitest";
import {
  isHabitComplianceQualifying,
  isPrCountQualifying,
  isStreakQualifying,
  shouldShowCompoundCelebration,
  buildCompoundCelebrationText,
} from "./compound-celebration";

describe("isHabitComplianceQualifying", () => {
  it("qualifies at or above 70%", () => {
    expect(isHabitComplianceQualifying(70)).toBe(true);
    expect(isHabitComplianceQualifying(92)).toBe(true);
  });
  it("does not qualify below 70%, or when null", () => {
    expect(isHabitComplianceQualifying(69)).toBe(false);
    expect(isHabitComplianceQualifying(null)).toBe(false);
  });
});

describe("isPrCountQualifying / isStreakQualifying", () => {
  it("PR count qualifies at 1+", () => {
    expect(isPrCountQualifying(0)).toBe(false);
    expect(isPrCountQualifying(1)).toBe(true);
  });
  it("streak qualifies at 2+ weeks, matching the existing streak-badge floor", () => {
    expect(isStreakQualifying(1)).toBe(false);
    expect(isStreakQualifying(2)).toBe(true);
  });
});

describe("shouldShowCompoundCelebration", () => {
  it("shows when all three qualify", () => {
    expect(
      shouldShowCompoundCelebration({ habitCompliancePct: 92, prCountThisMonth: 3, weekStreak: 8 })
    ).toBe(true);
  });

  it("shows when exactly two of three qualify", () => {
    expect(
      shouldShowCompoundCelebration({ habitCompliancePct: 92, prCountThisMonth: 0, weekStreak: 8 })
    ).toBe(true);
  });

  it("does not show when only one signal qualifies", () => {
    expect(
      shouldShowCompoundCelebration({ habitCompliancePct: 92, prCountThisMonth: 0, weekStreak: 1 })
    ).toBe(false);
  });

  it("does not show when nothing qualifies", () => {
    expect(
      shouldShowCompoundCelebration({ habitCompliancePct: null, prCountThisMonth: 0, weekStreak: 0 })
    ).toBe(false);
  });
});

describe("buildCompoundCelebrationText", () => {
  it("joins all three qualifying clauses with an Oxford comma", () => {
    expect(
      buildCompoundCelebrationText({ habitCompliancePct: 92, prCountThisMonth: 3, weekStreak: 8 })
    ).toBe("92% habit compliance, 3 new PRs, and an 8-week streak — this is what showing up looks like.");
  });

  it("joins exactly two qualifying clauses with 'and', no comma", () => {
    expect(
      buildCompoundCelebrationText({ habitCompliancePct: 92, prCountThisMonth: 0, weekStreak: 8 })
    ).toBe("92% habit compliance and an 8-week streak — this is what showing up looks like.");
  });

  it("uses singular 'PR' for exactly one, and 'a' (not 'an') before a 2-week streak", () => {
    const text = buildCompoundCelebrationText({
      habitCompliancePct: 92,
      prCountThisMonth: 1,
      weekStreak: 2,
    });
    expect(text).toContain("1 new PR,");
    expect(text).toContain("a 2-week streak");
  });

  it("leaves out a non-qualifying signal entirely rather than showing a weak number", () => {
    const text = buildCompoundCelebrationText({
      habitCompliancePct: 92,
      prCountThisMonth: 0,
      weekStreak: 8,
    });
    expect(text).not.toContain("PR");
  });
});
