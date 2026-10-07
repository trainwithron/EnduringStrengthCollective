import { describe, expect, it } from "vitest";
import { milestoneTagToPhase, phaseToMilestoneTag, resolvePhaseOfRecord, reviewIsDue, rowToPhasePlan, suggestedReviewDate, validatePhasePlan, weeksInPhase } from "@/lib/phase-plan";

describe("phase and milestone tag mapping", () => {
  it("goes both ways and maintenance has no tag", () => {
    expect(phaseToMilestoneTag("fat_loss")).toBe("cut");
    expect(phaseToMilestoneTag("hypertrophy")).toBe("bulk");
    expect(phaseToMilestoneTag("reverse_diet")).toBe("reverse_diet");
    expect(phaseToMilestoneTag("maintenance")).toBeNull();
    expect(milestoneTagToPhase("cut")).toBe("fat_loss");
    expect(milestoneTagToPhase("bulk")).toBe("hypertrophy");
    expect(milestoneTagToPhase("reverse_diet")).toBe("reverse_diet");
    expect(milestoneTagToPhase("x")).toBeNull();
  });
});

describe("the phase of record", () => {
  const plan = rowToPhasePlan({ phase: "reverse_diet", started_on: "2026-09-01", review_on: "2026-10-01", planned_next_phase: "maintenance" });
  it("reads a row", () => {
    expect(plan).toEqual({ phase: "reverse_diet", startedOn: "2026-09-01", reviewOn: "2026-10-01", plannedNextPhase: "maintenance", lastReviewedAt: null });
    expect(rowToPhasePlan({ phase: "bogus", started_on: "2026-09-01" })).toBeNull();
    expect(rowToPhasePlan(null)).toBeNull();
  });
  it("the plan, then the latest check-in, then the tag, else none", () => {
    expect(resolvePhaseOfRecord({ plan, latestCheckinPhase: "fat_loss", milestoneTag: "bulk" })).toEqual({ phase: "reverse_diet", source: "plan" });
    expect(resolvePhaseOfRecord({ plan: null, latestCheckinPhase: "fat_loss", milestoneTag: "bulk" })).toEqual({ phase: "fat_loss", source: "checkin" });
    expect(resolvePhaseOfRecord({ plan: null, latestCheckinPhase: null, milestoneTag: "bulk" })).toEqual({ phase: "hypertrophy", source: "tag" });
    expect(resolvePhaseOfRecord({ plan: null })).toBeNull();
  });
  it("counts weeks from 1", () => {
    expect(weeksInPhase("2026-10-01", "2026-10-01")).toBe(1);
    expect(weeksInPhase("2026-10-01", "2026-10-07")).toBe(1);
    expect(weeksInPhase("2026-10-01", "2026-10-08")).toBe(2);
    expect(weeksInPhase("2026-10-01", "2026-11-12")).toBe(7);
    expect(weeksInPhase("2026-10-10", "2026-10-01")).toBe(1);
  });
  it("the suggested review is 14 days out", () => {
    expect(suggestedReviewDate("2026-10-07")).toBe("2026-10-21");
    expect(suggestedReviewDate("2026-12-25")).toBe("2027-01-08");
  });
  it("a review is due on its date and after, and only ever raises a prompt", () => {
    expect(reviewIsDue(plan, "2026-09-30")).toBe(false);
    expect(reviewIsDue(plan, "2026-10-01")).toBe(true);
    expect(reviewIsDue(plan, "2027-01-01")).toBe(true);
    expect(reviewIsDue(null, "2027-01-01")).toBe(false);
    expect(reviewIsDue({ ...plan!, reviewOn: null }, "2027-01-01")).toBe(false);
  });
});

describe("saving a phase plan", () => {
  it("refuses a bad phase, a bad next phase, a malformed or past review date", () => {
    expect(validatePhasePlan({ phase: "x", reviewOn: null, plannedNextPhase: null, todayKey: "2026-10-07" })).toMatch(/phase/i);
    expect(validatePhasePlan({ phase: "fat_loss", reviewOn: null, plannedNextPhase: "x", todayKey: "2026-10-07" })).toMatch(/next/i);
    expect(validatePhasePlan({ phase: "fat_loss", reviewOn: "10/20", plannedNextPhase: null, todayKey: "2026-10-07" })).toMatch(/review date/i);
    expect(validatePhasePlan({ phase: "fat_loss", reviewOn: "2026-10-06", plannedNextPhase: null, todayKey: "2026-10-07" })).toMatch(/past/i);
  });
  it("accepts today or later, no review, and any next phase including the same one", () => {
    expect(validatePhasePlan({ phase: "fat_loss", reviewOn: "2026-10-07", plannedNextPhase: "fat_loss", todayKey: "2026-10-07" })).toBeNull();
    expect(validatePhasePlan({ phase: "reverse_diet", reviewOn: null, plannedNextPhase: "", todayKey: "2026-10-07" })).toBeNull();
  });
});
