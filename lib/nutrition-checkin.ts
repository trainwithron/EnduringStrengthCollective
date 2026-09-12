// Ported from Ron's own standalone check-in tool
// (enduring_strength_fixed_1.html's PHASE_CONFIG + runCheckInEngine()) —
// every threshold below is copied directly from that source, not
// re-derived. See lib/nutrition-checkin.test.ts for boundary coverage,
// matching lib/program-schedule.ts's isLocked testing discipline.
//
// One deliberate, documented correction to the source: the fat-loss
// "optimal rate" branch as originally written compared
// `pctChange <= optimalPctMin && pctChange >= optimalPctMax` (i.e.
// <= -1.2 AND >= -0.5) — mathematically impossible for any single
// number, so it was dead code in the source tool. A real optimal-rate
// check-in fell through to the generic "within expected variance"
// branch instead, which computes the identical outcome (hold calories
// steady) with different rationale text. Corrected here to the
// evidently intended range (pctChange between optimalPctMin and
// optimalPctMax) so the more specific, accurate message is the one that
// actually shows — the calorie math itself is unchanged either way.

export type NutritionPhase = "fat_loss" | "hypertrophy" | "maintenance";

export const PHASE_CONFIG = {
  MIN_ADHERENT_DAYS: 5,
  fat_loss: {
    optimalPctMin: -1.2,
    optimalPctMax: -0.5,
    stallPctThreshold: -0.3,
    stallDeltaLbsThreshold: -0.4,
    lowRecoveryThreshold: 2,
    stallCutConservativePct: 0.96,
    stallCutAggressivePct: 0.92,
    tooRapidPctThreshold: -1.5,
    tooRapidCalAdjustPct: 1.05,
  },
  hypertrophy: {
    lossReversalKcal: 150,
    stallPctThreshold: 0.1,
    stallDeltaLbsThreshold: 0.2,
    stallAddKcal: 100,
    spikePctThreshold: 0.6,
    spikeDeltaLbsThreshold: 1.2,
    spikeConsecutiveWeeksToTrim: 2,
    spikeTrimKcal: 100,
  },
} as const;

export interface CheckInInput {
  phase: NutritionPhase;
  prevWeightLbs: number;
  currWeightLbs: number;
  currentCalories: number;
  adherenceDays: number; // 0-7
  recoveryRating: number; // 1-5
  // Hypertrophy-only running state — how many CONSECUTIVE prior weeks
  // spiked without yet triggering a trim. 0 if this is the first
  // check-in, or the athlete isn't in a hypertrophy phase.
  consecutiveSurplusSpikes: number;
}

export interface CheckInResult {
  newCalories: number;
  rationale: string;
  // Updated spike count to persist and feed into the *next* check-in.
  consecutiveSurplusSpikes: number;
}

export function runCheckInEngine(input: CheckInInput): CheckInResult {
  const { phase, prevWeightLbs, currWeightLbs, currentCalories, adherenceDays, recoveryRating } = input;
  let newCalories = currentCalories;
  let rationale = "";
  let spikes = input.consecutiveSurplusSpikes;

  const deltaLbs = currWeightLbs - prevWeightLbs;
  const pctChange = prevWeightLbs > 0 ? (deltaLbs / prevWeightLbs) * 100 : 0;

  if (adherenceDays < PHASE_CONFIG.MIN_ADHERENT_DAYS) {
    rationale = `Inconsistent adherence (${adherenceDays}/7 days). Caloric baseline held steady to re-establish execution.`;
  } else if (phase === "fat_loss") {
    const cfg = PHASE_CONFIG.fat_loss;
    if (pctChange >= cfg.optimalPctMin && pctChange <= cfg.optimalPctMax) {
      rationale = `Optimal fat loss rate achieved. Calorie targets held steady.`;
    } else if (pctChange > cfg.stallPctThreshold && deltaLbs >= cfg.stallDeltaLbsThreshold) {
      if (recoveryRating <= cfg.lowRecoveryThreshold) {
        newCalories = Math.round(currentCalories * cfg.stallCutConservativePct);
        rationale = `Fat loss plateau detected, but fatigue is high. Applied a conservative ${Math.round(
          (1 - cfg.stallCutConservativePct) * 100
        )}% deficit.`;
      } else {
        newCalories = Math.round(currentCalories * cfg.stallCutAggressivePct);
        rationale = `Weight stalled over past 7 days. Scaled daily calories down ${Math.round(
          (1 - cfg.stallCutAggressivePct) * 100
        )}% to re-stimulate fat loss.`;
      }
    } else if (pctChange < cfg.tooRapidPctThreshold) {
      newCalories = Math.round(currentCalories * cfg.tooRapidCalAdjustPct);
      rationale = `Weight loss too rapid. Added +${Math.round(
        (cfg.tooRapidCalAdjustPct - 1) * 100
      )}% calories to preserve lean tissue.`;
    } else {
      rationale = `Fat loss rate within expected variance. Targets held steady.`;
    }
  } else if (phase === "hypertrophy") {
    const cfg = PHASE_CONFIG.hypertrophy;
    if (deltaLbs < 0) {
      newCalories = currentCalories + cfg.lossReversalKcal;
      spikes = 0;
      rationale = `Weight dropped during muscle building phase. Added +${cfg.lossReversalKcal} kcal.`;
    } else if (pctChange < cfg.stallPctThreshold && deltaLbs <= cfg.stallDeltaLbsThreshold) {
      newCalories = currentCalories + cfg.stallAddKcal;
      spikes = 0;
      rationale = `Surplus rate stalled. Nudged intake up by +${cfg.stallAddKcal} kcal.`;
    } else if (pctChange > cfg.spikePctThreshold || deltaLbs > cfg.spikeDeltaLbsThreshold) {
      spikes += 1;
      if (spikes >= cfg.spikeConsecutiveWeeksToTrim) {
        newCalories = currentCalories - cfg.spikeTrimKcal;
        spikes = 0;
        rationale = `Weight increased above target velocity for ${cfg.spikeConsecutiveWeeksToTrim} weeks. Trimmed ${cfg.spikeTrimKcal} kcal.`;
      } else {
        rationale = `Weight increased sharply. Holding calories steady for a settling period.`;
      }
    } else {
      spikes = 0;
      rationale = `Hypertrophy progression on track. Surplus held steady.`;
    }
  } else {
    rationale = `Body mass stabilized within maintenance threshold.`;
  }

  return { newCalories, rationale, consecutiveSurplusSpikes: spikes };
}
