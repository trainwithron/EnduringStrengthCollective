// Goal-date-aware nutrition — the safe cut/gain rate cap
// (goal_date_aware_nutrition_and_programming_idea.md). Real sourced
// numbers, not a guess: Garthe et al. (peer-reviewed, PubMed) found a
// 0.7%/week loss rate preserved lean mass while a 1.4%/week rate didn't
// — past ~0.7%/week, muscle retention measurably breaks down.
// Competition-prep specifically caps tighter, at 0.5%/week, matching a
// physique-athlete sports-nutrition review and Jon Heck's own already-
// sourced gain rate.
//
// Governing rule: flag it, give a real disclaimer, assign the safest
// rate the system can responsibly recommend — never pretend to enforce
// compliance it can't enforce ("people are gonna eat what they're gonna
// eat at the end of the day," Ron's own words). Honest information, not
// false authority.

export const DEFAULT_SAFE_RATE_PCT_PER_WEEK = 0.5;
export const MAX_SAFE_RATE_PCT_PER_WEEK = 0.7;

export interface SafeGoalRateResult {
  requestedRatePctPerWeek: number;
  recommendedRatePctPerWeek: number;
  wasCapped: boolean;
  disclaimer: string | null;
}

// `direction` is +1 for a gain, -1 for a loss — the cap applies to the
// magnitude either way, the sign is preserved in the result.
export function computeSafeGoalRate(params: {
  currentWeight: number;
  targetWeight: number;
  weeksRemaining: number;
  isCompetitionPrep: boolean;
}): SafeGoalRateResult {
  const { currentWeight, targetWeight, weeksRemaining } = params;
  const direction = targetWeight >= currentWeight ? 1 : -1;
  const totalPctChange = (Math.abs(targetWeight - currentWeight) / currentWeight) * 100;
  const requestedRatePctPerWeek = weeksRemaining > 0 ? totalPctChange / weeksRemaining : Infinity;

  const cap = params.isCompetitionPrep ? DEFAULT_SAFE_RATE_PCT_PER_WEEK : MAX_SAFE_RATE_PCT_PER_WEEK;

  if (requestedRatePctPerWeek <= cap) {
    return {
      requestedRatePctPerWeek: direction * requestedRatePctPerWeek,
      recommendedRatePctPerWeek: direction * requestedRatePctPerWeek,
      wasCapped: false,
      disclaimer: null,
    };
  }

  return {
    requestedRatePctPerWeek: direction * requestedRatePctPerWeek,
    recommendedRatePctPerWeek: direction * cap,
    wasCapped: true,
    disclaimer: `The timeline given would need a ${requestedRatePctPerWeek.toFixed(
      1
    )}%/week rate to hit the target date, which is faster than what's generally considered safe (research shows rates above ~${MAX_SAFE_RATE_PCT_PER_WEEK}%/week risk losing muscle instead of just fat). Recommending ${cap}%/week instead — the date may need to move, or the target may need to be revisited.`,
  };
}
