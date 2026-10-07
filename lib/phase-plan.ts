import type { NutritionPhase } from "@/lib/nutrition-checkin";
import { addDaysToKey, daysBetweenKeys } from "@/lib/date-key";

// The phase a client is in, in the engine's own words (client_phase_plans.phase). "Muscle building" on screen is stored as hypertrophy. The milestone tag the trend
// detectors read (nutrition_phases: cut | bulk | reverse_diet) follows it through the mapping below; maintenance clears the tag.

export const PHASES: NutritionPhase[] = ["fat_loss", "hypertrophy", "maintenance", "reverse_diet"];

export const PHASE_LABELS: Record<NutritionPhase, string> = {
  fat_loss: "Fat loss",
  hypertrophy: "Muscle building",
  maintenance: "Maintenance",
  reverse_diet: "Reverse diet",
};

export type MilestoneTag = "cut" | "bulk" | "reverse_diet";

export function phaseToMilestoneTag(phase: NutritionPhase): MilestoneTag | null {
  if (phase === "fat_loss") return "cut";
  if (phase === "hypertrophy") return "bulk";
  if (phase === "reverse_diet") return "reverse_diet";
  return null;
}

export function milestoneTagToPhase(tag: string | null | undefined): NutritionPhase | null {
  if (tag === "cut") return "fat_loss";
  if (tag === "bulk") return "hypertrophy";
  if (tag === "reverse_diet") return "reverse_diet";
  return null;
}

export const isNutritionPhase = (v: unknown): v is NutritionPhase => PHASES.includes(v as NutritionPhase);

export const DEFAULT_REVIEW_DAYS = 14;
export const suggestedReviewDate = (todayKey: string): string => addDaysToKey(todayKey, DEFAULT_REVIEW_DAYS);

export interface PhasePlan {
  phase: NutritionPhase;
  startedOn: string;
  reviewOn: string | null;
  plannedNextPhase: NutritionPhase | null;
  lastReviewedAt: string | null;
}

export function rowToPhasePlan(row: Record<string, unknown> | null | undefined): PhasePlan | null {
  if (!row || !isNutritionPhase(row.phase) || typeof row.started_on !== "string") return null;
  return {
    phase: row.phase,
    startedOn: row.started_on.slice(0, 10),
    reviewOn: typeof row.review_on === "string" ? row.review_on.slice(0, 10) : null,
    plannedNextPhase: isNutritionPhase(row.planned_next_phase) ? row.planned_next_phase : null,
    lastReviewedAt: typeof row.last_reviewed_at === "string" ? row.last_reviewed_at : null,
  };
}

// The phase of record, in order: the plan row; else the latest check-in's phase; else the milestone tag mapped; else none (the engine does not guess a phase).
export function resolvePhaseOfRecord(args: {
  plan: PhasePlan | null;
  latestCheckinPhase?: string | null;
  milestoneTag?: string | null;
}): { phase: NutritionPhase; source: "plan" | "checkin" | "tag" } | null {
  if (args.plan) return { phase: args.plan.phase, source: "plan" };
  if (isNutritionPhase(args.latestCheckinPhase)) return { phase: args.latestCheckinPhase, source: "checkin" };
  const tagged = milestoneTagToPhase(args.milestoneTag);
  return tagged ? { phase: tagged, source: "tag" } : null;
}

// Week 1 is the first seven days of the phase.
export function weeksInPhase(startedOn: string, todayKey: string): number {
  const days = daysBetweenKeys(startedOn, todayKey);
  return days == null || days < 0 ? 1 : Math.floor(days / 7) + 1;
}

// Plain problem text, or null when the plan is fine to save. The review date may be today or later; the planned next phase may be any phase (the same phase means
// "keep going"), so it is never refused.
export function validatePhasePlan(args: { phase: string; reviewOn: string | null; plannedNextPhase: string | null; todayKey: string }): string | null {
  if (!isNutritionPhase(args.phase)) return "Pick a phase.";
  if (args.plannedNextPhase != null && args.plannedNextPhase !== "" && !isNutritionPhase(args.plannedNextPhase)) return "Pick a phase for what comes next, or none.";
  if (args.reviewOn) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(args.reviewOn)) return "Pick a review date.";
    if (args.reviewOn < args.todayKey) return "The review date can't be in the past.";
  }
  return null;
}

// A review is due when its date is today or earlier. It only RAISES a prompt for the coach: nothing ever changes by itself because a date passed.
export const reviewIsDue = (plan: PhasePlan | null, todayKey: string): boolean => !!plan?.reviewOn && plan.reviewOn <= todayKey;
