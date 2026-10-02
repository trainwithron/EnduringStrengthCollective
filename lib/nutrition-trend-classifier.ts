// Milestone Celebrations, Category 2 (milestone_celebration_system_scoping.md)
// — generalizing the flagship beyond reverse dieting. Ron's own framing:
// the system should be able to "intuit what you're doing by your trend
// lines," and a trend that doesn't match a coach's own tagged goal is
// itself a useful signal — for that one client, and in aggregate across
// a coach's whole roster. This is a genuinely different question from
// the flagship's own success check (lib/metabolic-trend.ts's
// computeReverseDietMilestone, which asks "did THIS SPECIFIC reverse
// diet pattern clear a calibrated bar") — this classifies what the
// trend actually IS, independent of what anyone tagged, then compares
// that against the tag. Reuses the same windowed-average primitive.

import { computeWindowedAverage, type DateValueRow } from "./metabolic-trend";
import type { NutritionPhase } from "./nutrition-checkin";

export type NutritionTrend = "cutting" | "bulking" | "reverse_dieting" | "maintaining" | "ambiguous";
// Renamed from NutritionPhase (progression_systems_and_phase_vocab_deep_dive_sept30.md)
// — a genuinely different type from lib/nutrition-checkin.ts's own
// NutritionPhase (4 values: fat_loss/hypertrophy/maintenance/reverse_diet,
// the canonical check-in vocabulary) that happened to share the same
// name. This one is specifically the coach's 3-way milestone-tracking
// tag (no "maintenance" concept — untagged/null already means that).
export type MilestonePhaseTag = "reverse_diet" | "cut" | "bulk";

export interface TrendClassification {
  trend: NutritionTrend;
  calorieChangePct: number;
  weightChangePct: number;
}

// Bands below which a change reads as "flat" rather than a real
// direction — noise tolerance, same reasoning as every other windowed-
// average comparison in this thread (a single data point never decides
// the read, and small real-world wobble shouldn't either).
const CALORIE_FLAT_BAND_PCT = 3;
const WEIGHT_FLAT_BAND_PCT = 1;

// Purely descriptive — reads the trend as it actually is, with no idea
// what (if anything) was intended. Returns null when there isn't enough
// real data in either half of the window to judge at all.
export function classifyNutritionTrend(
  calorieRows: DateValueRow[],
  weightRows: DateValueRow[],
  asOf: Date,
  windowWeeks = 6
): TrendClassification | null {
  const windowStart = new Date(asOf);
  windowStart.setDate(windowStart.getDate() - windowWeeks * 7 + 1);
  const halfwayMs = (asOf.getTime() - windowStart.getTime()) / 2;
  const firstHalfEnd = new Date(windowStart.getTime() + halfwayMs);
  const secondHalfStart = new Date(firstHalfEnd.getTime() + 24 * 60 * 60 * 1000);

  const firstCal = computeWindowedAverage(calorieRows, windowStart, firstHalfEnd);
  const secondCal = computeWindowedAverage(calorieRows, secondHalfStart, asOf);
  const firstWeight = computeWindowedAverage(weightRows, windowStart, firstHalfEnd);
  const secondWeight = computeWindowedAverage(weightRows, secondHalfStart, asOf);

  if (
    firstCal == null ||
    secondCal == null ||
    firstWeight == null ||
    secondWeight == null ||
    firstCal === 0 ||
    firstWeight === 0
  ) {
    return null;
  }

  const calorieChangePct = Math.round(((secondCal - firstCal) / firstCal) * 1000) / 10;
  const weightChangePct = Math.round(((secondWeight - firstWeight) / firstWeight) * 1000) / 10;

  const caloriesUp = calorieChangePct > CALORIE_FLAT_BAND_PCT;
  const caloriesDown = calorieChangePct < -CALORIE_FLAT_BAND_PCT;
  const weightUp = weightChangePct > WEIGHT_FLAT_BAND_PCT;
  const weightDown = weightChangePct < -WEIGHT_FLAT_BAND_PCT;

  let trend: NutritionTrend;
  if (caloriesDown && weightDown) trend = "cutting";
  else if (caloriesUp && weightUp) trend = "bulking";
  else if (caloriesUp && !weightUp) trend = "reverse_dieting"; // up calories, flat-or-down weight
  else if (!caloriesUp && !caloriesDown && !weightUp && !weightDown) trend = "maintaining";
  else trend = "ambiguous"; // e.g. calories down but weight up — a real, worth-a-look mismatch

  return { trend, calorieChangePct, weightChangePct };
}

// progression_systems_and_phase_vocab_deep_dive_sept30.md — none of the
// macro/meal-plan tools ever read a client's real tagged phase to seed
// their own default, so a client tagged "Bulk" could open the Meal Plan
// Generator and have it default to "Fat Loss," the literal opposite of
// what's tagged. Maps the client-profile tag's narrower 3-way vocabulary
// onto the canonical 4-way one those tools now share; untagged (null)
// maps to "maintenance" — the same neutral default those tools already
// used before this existed, not a new assumption.
export function milestoneTagToNutritionPhase(tag: MilestonePhaseTag | null | undefined): NutritionPhase {
  if (tag === "cut") return "fat_loss";
  if (tag === "bulk") return "hypertrophy";
  if (tag === "reverse_diet") return "reverse_diet";
  return "maintenance";
}

export function expectedTrendForPhase(phase: MilestonePhaseTag): NutritionTrend {
  if (phase === "reverse_diet") return "reverse_dieting";
  if (phase === "cut") return "cutting";
  return "bulking";
}

export function isTrendAligned(classification: TrendClassification, phase: MilestonePhaseTag): boolean {
  return classification.trend === expectedTrendForPhase(phase);
}

export interface NutritionWeeklySeries {
  calorieIndexed: (number | null)[];
  weightIndexed: (number | null)[];
}

// A small, visual-only companion to classifyNutritionTrend — buckets the
// same two series into weekly averages (not the classifier's own two-
// half comparison) and indexes each to its own first real week = 100,
// same "index to a shared baseline" convention already used by
// lib/program-card-visuals.ts's weekly volume sparkline. Feeds the
// client-card trend line, not any detection logic — a coarser, lower
// data-density bar (0.1 vs the classifier's 0.5) is fine here since a
// gap just renders as a break in the line rather than a wrong verdict.
export function computeNutritionWeeklySeries(
  calorieRows: DateValueRow[],
  weightRows: DateValueRow[],
  asOf: Date,
  weekCount = 6
): NutritionWeeklySeries {
  const calorieWeeks: (number | null)[] = [];
  const weightWeeks: (number | null)[] = [];
  for (let w = weekCount - 1; w >= 0; w--) {
    const weekEnd = new Date(asOf);
    weekEnd.setDate(weekEnd.getDate() - w * 7);
    const weekStart = new Date(weekEnd);
    weekStart.setDate(weekStart.getDate() - 6);
    calorieWeeks.push(computeWindowedAverage(calorieRows, weekStart, weekEnd, 0.1));
    weightWeeks.push(computeWindowedAverage(weightRows, weekStart, weekEnd, 0.1));
  }

  const firstCalorie = calorieWeeks.find((v) => v != null) ?? null;
  const firstWeight = weightWeeks.find((v) => v != null) ?? null;

  return {
    calorieIndexed: calorieWeeks.map((v) => (v != null && firstCalorie ? (v / firstCalorie) * 100 : null)),
    weightIndexed: weightWeeks.map((v) => (v != null && firstWeight ? (v / firstWeight) * 100 : null)),
  };
}
