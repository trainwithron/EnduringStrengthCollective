// Milestone Celebrations, flagship (milestone_celebration_system_scoping.md)
// — the reverse-diet / metabolic-adaptation detector. Deliberately
// windowed-average comparison, not raw day-to-day deltas: body weight
// swings day to day from water/sodium/GI content, so a single lucky or
// unlucky weigh-in must never trigger or block a real milestone —
// same defense already used by computeMonthlyGrowth/computeWeeklyActivity's
// zero-filled-bucket pattern elsewhere in this app.

export interface DateValueRow {
  date: string; // "YYYY-MM-DD"
  value: number;
}

// Averages values whose date falls within [windowStart, windowEnd]
// (inclusive). Returns null when there isn't enough real data in that
// window to trust a judgment — fewer than half the days in the window
// have a logged value — rather than silently averaging a sparse handful
// of points as if they represented the whole period.
export function computeWindowedAverage(
  rows: DateValueRow[],
  windowStart: Date,
  windowEnd: Date,
  minCoveragePct = 0.5
): number | null {
  const startKey = windowStart.toISOString().slice(0, 10);
  const endKey = windowEnd.toISOString().slice(0, 10);
  const inWindow = rows.filter((r) => r.date >= startKey && r.date <= endKey);
  const totalDays =
    Math.round((windowEnd.getTime() - windowStart.getTime()) / (24 * 60 * 60 * 1000)) + 1;
  if (totalDays <= 0) return null;
  if (inWindow.length / totalDays < minCoveragePct) return null;
  const sum = inWindow.reduce((s, r) => s + r.value, 0);
  return sum / inWindow.length;
}

export interface ReverseDietMilestoneResult {
  qualifies: boolean;
  calorieIncrease: number; // kcal/day, first-half avg vs last-half avg of the window
  weightChangePct: number; // over the window, relative to the starting average
  // Ron's own framing: "you'd be gaining ~X lbs/week at this rate" — a
  // standard 3500 kcal/lb conversion applied to the calorie increase
  // alone, independent of what actually happened to weight. Pairing this
  // with weightChangePct is what makes "metabolism adapted" legible
  // rather than asserted: here's what a surplus this size SHOULD have
  // done, here's what it actually did.
  weeklyExpectedGainLbs: number;
}

const KCAL_PER_LB = 3500;

// Compares the first half of the window against the second half for both
// series. Returns null (not a false "doesn't qualify") when either
// series doesn't have enough real data in either half to judge at all —
// a real non-qualification and "we can't tell yet" must never look the
// same to a caller.
export function computeReverseDietMilestone(
  calorieRows: DateValueRow[],
  weightRows: DateValueRow[],
  asOf: Date,
  windowWeeks = 6,
  calorieIncreaseThresholdKcal = 75,
  weightChangeToleranceMinPct = -100,
  weightChangeToleranceMaxPct = 0.5
): ReverseDietMilestoneResult | null {
  const windowStart = new Date(asOf);
  windowStart.setDate(windowStart.getDate() - windowWeeks * 7 + 1);
  const halfwayMs = (asOf.getTime() - windowStart.getTime()) / 2;
  const firstHalfEnd = new Date(windowStart.getTime() + halfwayMs);
  const secondHalfStart = new Date(firstHalfEnd.getTime() + 24 * 60 * 60 * 1000);

  const firstHalfCalories = computeWindowedAverage(calorieRows, windowStart, firstHalfEnd);
  const secondHalfCalories = computeWindowedAverage(calorieRows, secondHalfStart, asOf);
  const firstHalfWeight = computeWindowedAverage(weightRows, windowStart, firstHalfEnd);
  const secondHalfWeight = computeWindowedAverage(weightRows, secondHalfStart, asOf);

  if (
    firstHalfCalories == null ||
    secondHalfCalories == null ||
    firstHalfWeight == null ||
    secondHalfWeight == null ||
    firstHalfWeight === 0
  ) {
    return null;
  }

  const calorieIncrease = Math.round(secondHalfCalories - firstHalfCalories);
  const weightChangeLbs = secondHalfWeight - firstHalfWeight;
  const weightChangePct = (weightChangeLbs / firstHalfWeight) * 100;
  const weeklyExpectedGainLbs = Math.round((calorieIncrease * 7 * 10) / KCAL_PER_LB) / 10;

  const qualifies =
    calorieIncrease >= calorieIncreaseThresholdKcal &&
    weightChangePct >= weightChangeToleranceMinPct &&
    weightChangePct <= weightChangeToleranceMaxPct;

  return { qualifies, calorieIncrease, weightChangePct: Math.round(weightChangePct * 10) / 10, weeklyExpectedGainLbs };
}
