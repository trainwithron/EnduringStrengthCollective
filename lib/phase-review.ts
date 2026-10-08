import { addDaysToKey, daysBetweenKeys } from "@/lib/date-key";
import { PHASE_CONFIG, type NutritionPhase } from "@/lib/nutrition-checkin";
import { PHASE_LABELS, weeksInPhase } from "@/lib/phase-plan";

// The phase review (nutrition phase 7): on the review date the coach is shown what actually happened over the phase, in plain terms, from the client's own weigh-ins and food log. It is
// only ever a PROMPT: nothing changes by itself because a date passed, and nothing here writes anything. Pure: no database, no clock, no AI.
//
// The window is the stretch since the phase began or was last reviewed (at most 4 weeks back). The weight trend is the average of the first 7 days of the window against the average of the
// latest 7 days, so a single weigh-in does not decide anything; it needs at least 2 weigh-ins at each end and a window of at least 2 weeks. The speed is the change as a percent of the
// starting average, per week, and is judged with the SAME lines the weekly check-in uses (lib/nutrition-checkin.ts PHASE_CONFIG).

export const REVIEW_MIN_DAYS = 14;
export const REVIEW_MAX_WINDOW_DAYS = 28;
export const MIN_WEIGHINS_PER_END = 2;
// Logged on at least this many days out of every 7, on average (the weekly check-in uses the same number).
export const MIN_ADHERENT_PER_7 = PHASE_CONFIG.MIN_ADHERENT_DAYS;
// A coaching rule of thumb, not a diagnosis: body fat at or above this is the commonly used "obese" range. Shown on the card.
export const BODY_FAT_LINE = { male: 25, female: 32 } as const;
// Weight within this much of flat, as a percent of body weight per week, reads as "no change".
export const FLAT_BAND_PCT = 0.3;
const MAINTENANCE_BAND_PCT = 0.5;

export type ReviewVerdict = "on_track" | "low_adherence" | "no_change" | "wrong_way" | "too_fast" | "not_enough_data";

export interface WeightPoint {
  loggedDate: string;
  // Pounds, as stored.
  weight: number;
}

export interface ReviewInput {
  phase: NutritionPhase;
  startedOn: string;
  // The date of the last review, if there was one: the window starts there.
  lastReviewedOn: string | null;
  todayKey: string;
  weights: WeightPoint[];
  // Days in the window on which the client logged any food that was not skipped.
  daysLogged: number;
  // The calories the client is on now, and the soft floor for them (information only).
  calories: number | null;
  floorCalories: number | null;
}

export interface PhaseReview {
  phase: NutritionPhase;
  weeksInPhase: number;
  windowStart: string;
  elapsedDays: number;
  daysLogged: number;
  adherenceOk: boolean;
  startAvg: number | null;
  latestAvg: number | null;
  startWeighIns: number;
  latestWeighIns: number;
  // Latest average minus the starting average, in pounds; null when the trend cannot be worked out.
  changeLbs: number | null;
  // Percent of the starting average per week (negative = losing); null when the trend cannot be worked out.
  weeklyRatePct: number | null;
  calories: number | null;
  underFloor: boolean;
  verdict: ReviewVerdict;
  // Why there is not enough to say, when that is the verdict.
  thin: "too_early" | "few_weighins" | null;
}

// The first day the review looks at: when the phase began or was last reviewed, but never more than 4 weeks back.
export function reviewWindowStart(startedOn: string, lastReviewedOn: string | null, todayKey: string): string {
  const latestStart = [startedOn, lastReviewedOn ?? startedOn].sort().pop() as string;
  const floor = addDaysToKey(todayKey, -(REVIEW_MAX_WINDOW_DAYS - 1));
  return latestStart > floor ? latestStart : floor;
}

const avg = (xs: number[]): number | null => (xs.length === 0 ? null : Math.round((xs.reduce((s, x) => s + x, 0) / xs.length) * 10) / 10);

export function buildPhaseReview(input: ReviewInput): PhaseReview {
  const { phase, todayKey } = input;
  const windowStart = reviewWindowStart(input.startedOn, input.lastReviewedOn, todayKey);
  const elapsedDays = Math.max(1, (daysBetweenKeys(windowStart, todayKey) ?? 0) + 1);
  const daysLogged = Math.max(0, Math.min(input.daysLogged, elapsedDays));
  // Integer arithmetic: 5 of 7 is exactly the line, 4 of 7 is under it.
  const adherenceOk = daysLogged * 7 >= MIN_ADHERENT_PER_7 * elapsedDays;
  const startEnd = addDaysToKey(windowStart, 6);
  const latestStart = addDaysToKey(todayKey, -6);
  const inWindow = input.weights.filter((w) => w.loggedDate >= windowStart && w.loggedDate <= todayKey && Number.isFinite(w.weight));
  const startPts = inWindow.filter((w) => w.loggedDate <= startEnd).map((w) => w.weight);
  const latestPts = inWindow.filter((w) => w.loggedDate >= latestStart).map((w) => w.weight);
  const startAvg = avg(startPts);
  const latestAvg = avg(latestPts);
  const underFloor = input.calories != null && input.floorCalories != null && input.calories < input.floorCalories;
  const base = {
    phase,
    weeksInPhase: weeksInPhase(input.startedOn, todayKey),
    windowStart,
    elapsedDays,
    daysLogged,
    adherenceOk,
    startAvg,
    latestAvg,
    startWeighIns: startPts.length,
    latestWeighIns: latestPts.length,
    calories: input.calories,
    underFloor,
  };
  const thinResult = (thin: "too_early" | "few_weighins"): PhaseReview => ({ ...base, changeLbs: null, weeklyRatePct: null, verdict: "not_enough_data", thin });

  // Two weeks is the least a weight TREND can say anything about.
  if (elapsedDays < REVIEW_MIN_DAYS) return thinResult("too_early");
  if (!adherenceOk) return { ...base, changeLbs: null, weeklyRatePct: null, verdict: "low_adherence", thin: null };
  if (startAvg == null || latestAvg == null || startPts.length < MIN_WEIGHINS_PER_END || latestPts.length < MIN_WEIGHINS_PER_END || startAvg <= 0) return thinResult("few_weighins");

  const changeLbs = Math.round((latestAvg - startAvg) * 10) / 10;
  // The two averages sit (window length - 7) days apart on average: that many weeks between them.
  const weeksApart = (elapsedDays - 7) / 7;
  const weeklyRatePct = Math.round(((changeLbs / startAvg) * 100 * 100) / weeksApart) / 100;
  return { ...base, changeLbs, weeklyRatePct, verdict: speedVerdict(phase, weeklyRatePct), thin: null };
}

// Whether the speed of weight change fits the phase, using the lines the weekly check-in already uses.
export function speedVerdict(phase: NutritionPhase, rate: number): ReviewVerdict {
  if (phase === "fat_loss") {
    if (rate < PHASE_CONFIG.fat_loss.tooRapidPctThreshold) return "too_fast";
    if (rate <= PHASE_CONFIG.fat_loss.stallPctThreshold) return "on_track";
    return rate <= FLAT_BAND_PCT ? "no_change" : "wrong_way";
  }
  if (phase === "hypertrophy") {
    if (rate > PHASE_CONFIG.hypertrophy.spikePctThreshold) return "too_fast";
    if (rate >= PHASE_CONFIG.hypertrophy.stallPctThreshold) return "on_track";
    return rate >= -FLAT_BAND_PCT ? "no_change" : "wrong_way";
  }
  if (phase === "reverse_diet") return rate <= PHASE_CONFIG.reverse_diet.weightFlatOrDownMaxPct ? "on_track" : "wrong_way";
  return Math.abs(rate) <= MAINTENANCE_BAND_PCT ? "on_track" : "wrong_way";
}

// ---- the stance: does what happened SUPPORT the planned next step? Decided here, from the numbers, never by a model. ----

export type Stance = "supports" | "does_not_support" | "unclear";

export interface PathAssessment {
  stance: Stance;
  factors: string[];
}

type BodyFatState = "unknown" | "needs_sex" | "at_or_above" | "below";
function bodyFatState(bodyFatPct: number | null, sex: "male" | "female" | null): BodyFatState {
  if (bodyFatPct == null) return "unknown";
  if (!sex) return "needs_sex";
  return bodyFatPct >= BODY_FAT_LINE[sex] ? "at_or_above" : "below";
}

export function pathAssessment(args: { review: PhaseReview; target: NutritionPhase; bodyFatPct: number | null; sex: "male" | "female" | null }): PathAssessment {
  const { review: r, target } = args;
  const bf = bodyFatState(args.bodyFatPct, args.sex);
  const factors: string[] = [];
  const result = (stance: Stance): PathAssessment => ({ stance, factors });
  const targetLabel = PHASE_LABELS[target].toLowerCase();

  // Always says what the numbers are, in words.
  if (r.verdict === "low_adherence") factors.push("Food was logged on too few days for the result to say much.");
  if (r.verdict === "not_enough_data") factors.push(r.thin === "too_early" ? "Less than two weeks of the phase so far, too early to read a weight trend." : "Too few weigh-ins to read a weight trend.");
  if (r.verdict === "no_change") factors.push("Weight has not moved much over the phase, with food logged most days.");
  if (r.verdict === "wrong_way") factors.push("Weight has moved the other way from what this phase aims for.");
  if (r.verdict === "too_fast") factors.push("Weight is changing faster than the usual safe range.");
  if (r.verdict === "on_track") factors.push("Weight is moving the way this phase aims for, at a sensible speed, with food logged most days.");

  if (target === r.phase) {
    // Continuing the same phase.
    if (r.phase === "fat_loss") {
      if (r.verdict === "too_fast") return result("does_not_support");
      if (r.underFloor && (r.verdict === "no_change" || r.verdict === "wrong_way")) {
        factors.push("Calories are under the soft floor and weight has not followed, so a longer deficit is not the answer on its own.");
        return result("does_not_support");
      }
      if (r.verdict === "on_track") return result("supports");
      // Body fat is a weak, self-reported rule of thumb: it never turns a result that is not working into a green light. "Supports" stays for a result that is on track.
      if (bf === "at_or_above" && (r.verdict === "no_change" || r.verdict === "wrong_way")) {
        factors.push("Body fat is at or above the rule-of-thumb line, which usually makes a longer deficit reasonable, but weight has not followed: check the calories and the logging before extending.");
      }
      return result("unclear");
    }
    if (r.verdict === "on_track") return result("supports");
    if (r.verdict === "wrong_way" || r.verdict === "too_fast") return result("does_not_support");
    return result("unclear");
  }

  if (target === "reverse_diet") {
    if (bf === "at_or_above") {
      factors.push(`Body fat is at or above the rule-of-thumb line (${args.sex === "female" ? BODY_FAT_LINE.female : BODY_FAT_LINE.male} percent), which usually means a longer deficit before rebuilding.`);
    }
    if (r.verdict === "low_adherence" || r.verdict === "no_change" || r.verdict === "wrong_way" || bf === "at_or_above") return result("does_not_support");
    if (r.verdict === "on_track" && bf === "below") {
      factors.push("Body fat is under the rule-of-thumb line, so rebuilding is a reasonable next step.");
      return result("supports");
    }
    if (bf === "unknown") factors.push("Body fat is not on file, so it cannot be checked against the rule-of-thumb line.");
    if (bf === "needs_sex") factors.push("Sex is not on file, so body fat cannot be checked against the rule-of-thumb line.");
    return result("unclear");
  }

  // Moving to maintenance, muscle building or fat loss from another phase.
  if (r.verdict === "low_adherence" || r.verdict === "no_change" || r.verdict === "wrong_way") return result("does_not_support");
  if (r.verdict === "on_track") {
    factors.push(`The result so far gives no reason against moving to ${targetLabel}.`);
    return result("supports");
  }
  return result("unclear");
}
