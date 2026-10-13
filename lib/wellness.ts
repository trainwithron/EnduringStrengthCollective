// Sleep quality, soreness, and energy are all stored so higher always
// means better (soreness 5 = fresh/no soreness) — see
// supabase/migrations/0114_wellness_checkins.sql for why — so a plain
// average of the three is a meaningful single readiness score.
// What the person SEES on the soreness scale is 1 = Fresh ... 5 = Very sore, the way people say it. What is STORED, and what every reader (readiness averages, low-readiness flags, charts, the coach
// briefing, the AI lookups) uses, stays as it always was: 5 = fresh. The flip happens only at the edges, in these two functions, so no stored row and no reader changes meaning.
export function sorenessShown(stored: number): number {
  return 6 - stored;
}
export function sorenessStored(shown: number): number {
  return 6 - shown;
}

export interface WellnessCheckinValues {
  sleepQuality: number;
  soreness: number;
  energy: number;
}

// Strictly below this average flags a client as "low readiness" on the
// coach's roster page — the neutral midpoint of the 1-5 scale itself
// (an exact 3 average) does not flag.
export const LOW_READINESS_THRESHOLD = 3;

export function computeReadinessAverage(values: WellnessCheckinValues): number {
  return (values.sleepQuality + values.soreness + values.energy) / 3;
}

export function isLowReadiness(values: WellnessCheckinValues): boolean {
  return computeReadinessAverage(values) < LOW_READINESS_THRESHOLD;
}
