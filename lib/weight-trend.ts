// Turns a client's real body-weight log into the same week-over-week
// comparison the meal engine's check-in already expects (current avg vs
// previous avg) — so the coach isn't retyping numbers that are already
// sitting in the database.

export interface WeightLogEntry {
  loggedDate: string; // "YYYY-MM-DD"
  weight: number;
}

export interface WeeklyWeightTrend {
  currentAvg: number | null;
  currentCount: number;
  previousAvg: number | null;
  previousCount: number;
  // currentAvg - previousAvg, rounded; null unless both sides have data.
  deltaLbs: number | null;
}

function daysBefore(anchorDateKey: string, loggedDateKey: string): number {
  const anchor = new Date(`${anchorDateKey}T00:00:00`);
  const logged = new Date(`${loggedDateKey}T00:00:00`);
  return Math.round((anchor.getTime() - logged.getTime()) / 86400000);
}

function average(values: number[]): number | null {
  if (values.length === 0) return null;
  return Math.round((values.reduce((sum, v) => sum + v, 0) / values.length) * 10) / 10;
}

// "Current week" is the 7 days ending on (and including) the anchor date;
// "previous week" is the 7 days immediately before that. A log dated
// after the anchor (shouldn't normally happen, but defensive) is ignored.
export function computeWeeklyWeightTrend(
  logs: WeightLogEntry[],
  anchorDateKey: string
): WeeklyWeightTrend {
  const current: number[] = [];
  const previous: number[] = [];

  for (const log of logs) {
    const diff = daysBefore(anchorDateKey, log.loggedDate);
    if (diff < 0) continue;
    if (diff <= 6) current.push(log.weight);
    else if (diff <= 13) previous.push(log.weight);
  }

  const currentAvg = average(current);
  const previousAvg = average(previous);

  return {
    currentAvg,
    currentCount: current.length,
    previousAvg,
    previousCount: previous.length,
    deltaLbs:
      currentAvg != null && previousAvg != null
        ? Math.round((currentAvg - previousAvg) * 10) / 10
        : null,
  };
}
