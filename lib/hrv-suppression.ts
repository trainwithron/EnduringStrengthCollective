// AI Assistant Slice 4 — HRV signal (ai_assistant_opus_deep_dive_findings.md).
// Oura's own hrv_balance contributor is already a 0-100 score normalized
// against the athlete's own 28-day rolling average, pre-computed by
// Oura — this detector doesn't need to build its own baseline math on
// top of that, it just reads the already-normalized score.
//
// Real usage rule from the research pass, not just "flag a low number":
// the real overreaching pattern is SUSTAINED suppression (7+ consecutive
// days below the threshold), not one bad night — a single low reading
// is expected, normal variation. And don't trust any reading as
// meaningful until the connection itself has ~2-3 months of real
// history behind it (a wider margin than Oura's own 28-day minimum, on
// the theory that a downstream interpretation of the score deserves
// more runway than the score's own computation does).

export const SUSTAINED_SUPPRESSION_DAYS = 7;
export const SUPPRESSION_THRESHOLD = 50; // below the midpoint of Oura's 0-100 scale
export const MIN_CONNECTION_AGE_DAYS = 60;

export interface DailyMetricPoint {
  date: string;
  value: number;
}

// `recentHrvBalancePoints` should be the most recent SUSTAINED_SUPPRESSION_DAYS
// days, sorted oldest -> newest. A gap (a day with no reading at all) is
// treated the same as a non-suppressed day — this only fires on a real,
// unbroken run of low readings, never inferring suppression from missing
// data.
export function isSustainedHrvSuppression(
  recentHrvBalancePoints: DailyMetricPoint[],
  connectionAgeDays: number
): boolean {
  if (connectionAgeDays < MIN_CONNECTION_AGE_DAYS) return false;
  if (recentHrvBalancePoints.length < SUSTAINED_SUPPRESSION_DAYS) return false;
  const lastWindow = recentHrvBalancePoints.slice(-SUSTAINED_SUPPRESSION_DAYS);
  return lastWindow.every((p) => p.value < SUPPRESSION_THRESHOLD);
}
