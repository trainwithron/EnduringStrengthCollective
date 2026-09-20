// Marketplace coach-ranking algorithm, Phase 1
// (marketplace_coach_ranking_algorithm_research_sept19.md). Pure,
// testable ranking logic — score = w_distance*f_distance +
// w_goalfit*f_goalfit + w_outcome*f_outcome, kept as plain lib
// functions first per this codebase's established
// pure-lib-then-gather-then-UI sequencing (e.g. lib/trainer-dispatch.ts,
// lib/programming-spotter.ts).
//
// Goal-fit reuses lib/trainer-dispatch.ts's mapGoalTypeToTrainingIntents/
// computeGoalFitScore directly, per the research's own explicit
// instruction — not rebuilt here.
import type { TrainingIntent } from "./training-intent";
import { computeGoalFitScore, type GoalType } from "./trainer-dispatch";

export type { GoalType };

// Real outcome signal only exists today for these two goal types
// (lib/weight-trend.ts's computeWeeklyWeightTrend, and exercise_records'
// direction-aware PB tracking for endurance events) — everything else
// ships distance+goal-fit only, re-normalized, per the research's own
// scoped ship/hold list.
const GOAL_TYPES_WITH_OUTCOME_SIGNAL: ReadonlySet<GoalType> = new Set([
  "weight_loss",
  "endurance_event",
]);

export function hasReliableOutcomeSignal(goalType: GoalType): boolean {
  return GOAL_TYPES_WITH_OUTCOME_SIGNAL.has(goalType);
}

// Inverse/exponential distance decay — d0=5 miles matches the coach's
// own "5-mile famous" local positioning. Always in (0, 1].
export function computeDistanceScore(distanceMiles: number, d0 = 5): number {
  if (distanceMiles <= 0) return 1;
  return 1 / (1 + distanceMiles / d0);
}

// Normalizes computeGoalFitScore's raw match count into [0, 1] by the
// coach's own total program count, so a coach with 20 programs and 5
// matching doesn't automatically outrank a coach with 2 programs and 2
// matching just because the raw count is bigger.
export function computeNormalizedGoalFitScore(
  intentCounts: Partial<Record<TrainingIntent, number>>,
  totalProgramCount: number,
  goalType: GoalType
): number {
  if (totalProgramCount <= 0) return 0;
  const raw = computeGoalFitScore(intentCounts, goalType);
  return Math.min(1, raw / totalProgramCount);
}

// Confounding/difficulty signal: a goal with an aggressive timeline
// (short span between when it was set and its target date) is a
// genuinely harder case than an identical goal with a generous
// timeline — derived entirely from client_goals' own existing
// created_at/target_date columns, no new intake question needed.
// baselineDays=84 (12 weeks) is a representative "typical" program
// length; weight is clamped so one extreme case can't dominate the
// whole computation.
export function computeDifficultyWeight(
  goalCreatedAt: string,
  targetDate: string | null,
  baselineDays = 84
): number {
  if (!targetDate) return 1;
  const created = new Date(goalCreatedAt).getTime();
  const target = new Date(targetDate).getTime();
  const timelineDays = (target - created) / 86400000;
  if (timelineDays <= 0) return 2.5;
  return Math.min(2.5, Math.max(0.5, baselineDays / timelineDays));
}

export interface ClientOutcomeCase {
  clientId: string;
  success: boolean;
  goalCreatedAt: string;
  targetDate: string | null;
}

// Difficulty-weighted Wilson score lower bound — the fairness mechanism
// the research explicitly locked in (rejecting Bayesian shrinkage for
// needing an arbitrary tunable constant with no data to derive it
// from). Weights each case's contribution to both the success count and
// the effective sample size by computeDifficultyWeight, using the Kish
// effective-sample-size formula (sum(w)^2 / sum(w^2)) so a handful of
// very hard cases doesn't masquerade as a large, reliable sample.
// Returns null for n=0 (undefined, never zero, per the research's own
// cold-start rule) rather than throwing or returning 0.
export function computeWeightedWilsonLowerBound(
  cases: ClientOutcomeCase[],
  options: { z?: number; baselineDays?: number } = {}
): number | null {
  if (cases.length === 0) return null;
  const z = options.z ?? 1.96;
  const baselineDays = options.baselineDays ?? 84;

  const weights = cases.map((c) => computeDifficultyWeight(c.goalCreatedAt, c.targetDate, baselineDays));
  const sumW = weights.reduce((s, w) => s + w, 0);
  const sumW2 = weights.reduce((s, w) => s + w * w, 0);
  const sumWSuccess = cases.reduce((s, c, i) => s + (c.success ? weights[i] : 0), 0);

  const pHat = sumWSuccess / sumW;
  const effectiveN = sumW2 > 0 ? (sumW * sumW) / sumW2 : sumW;

  const denominator = 1 + (z * z) / effectiveN;
  const centre = pHat + (z * z) / (2 * effectiveN);
  const margin = z * Math.sqrt((pHat * (1 - pHat)) / effectiveN + (z * z) / (4 * effectiveN * effectiveN));
  return (centre - margin) / denominator;
}

export interface RankingWeights {
  distance: number;
  goalFit: number;
  outcome: number;
}

// Starting weights per the research — real, visible, and adjustable via
// the marketplace_ranking_weights table (a platform-admin-only control),
// not a black-box blend like the org-dispatch ranking's own gap.
export const DEFAULT_RANKING_WEIGHTS: RankingWeights = { distance: 0.3, goalFit: 0.3, outcome: 0.4 };

function renormalizeWithoutOutcome(weights: RankingWeights): RankingWeights {
  const sum = weights.distance + weights.goalFit;
  if (sum <= 0) return { distance: 0.5, goalFit: 0.5, outcome: 0 };
  return { distance: weights.distance / sum, goalFit: weights.goalFit / sum, outcome: 0 };
}

export interface CoachRankingInput {
  distanceMiles: number;
  intentCounts: Partial<Record<TrainingIntent, number>>;
  totalProgramCount: number;
  goalType: GoalType;
  // Every past/current client of this coach with a confirmed goal of
  // this type — null/omitted goal types with no reliable signal
  // (everything except weight_loss/endurance_event) always resolve as
  // if this were an empty array; hasReliableOutcomeSignal is checked
  // internally so callers don't have to branch first.
  outcomeCases: ClientOutcomeCase[];
  // Airbnb-style cold-start substitution: only used when this coach has
  // zero real outcome cases (n=0) AND is inside their own "Newly
  // Verified" boost window.
  isInNewlyVerifiedBoostWindow?: boolean;
  platformAverageOutcomeScore?: number | null;
  weights?: RankingWeights;
}

export interface CoachRankingResult {
  score: number;
  distanceScore: number;
  goalFitScore: number;
  // null when the outcome factor was dropped entirely (no reliable
  // signal for this goal type, or n=0 outside the boost window) —
  // distinct from a real computed 0.
  outcomeScore: number | null;
  weightsUsed: RankingWeights;
}

export function computeCoachRankingScore(input: CoachRankingInput): CoachRankingResult {
  const weights = input.weights ?? DEFAULT_RANKING_WEIGHTS;
  const distanceScore = computeDistanceScore(input.distanceMiles);
  const goalFitScore = computeNormalizedGoalFitScore(input.intentCounts, input.totalProgramCount, input.goalType);

  let outcomeScore: number | null = null;
  let weightsUsed = weights;

  if (hasReliableOutcomeSignal(input.goalType)) {
    if (input.outcomeCases.length > 0) {
      outcomeScore = computeWeightedWilsonLowerBound(input.outcomeCases);
    } else if (input.isInNewlyVerifiedBoostWindow && input.platformAverageOutcomeScore != null) {
      outcomeScore = input.platformAverageOutcomeScore;
    }
  }

  if (outcomeScore === null) {
    weightsUsed = renormalizeWithoutOutcome(weights);
  }

  const score =
    weightsUsed.distance * distanceScore +
    weightsUsed.goalFit * goalFitScore +
    (outcomeScore != null ? weightsUsed.outcome * outcomeScore : 0);

  return { score, distanceScore, goalFitScore, outcomeScore, weightsUsed };
}
