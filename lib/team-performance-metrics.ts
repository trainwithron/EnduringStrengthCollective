// Pure computations behind the Team Performance dashboard — same style
// as lib/business-metrics.ts (plain typed rows in, a summary/bucket
// array out). Scoped per-group, not business-wide, since blending two
// different teams' PRs/wellness into one number serves no one.

import { computeReadinessAverage } from "./wellness";

export interface DailyWellnessRow {
  logDate: string; // "YYYY-MM-DD"
  sleepQuality: number;
  soreness: number;
  energy: number;
}

// Groups by logDate, averaging computeReadinessAverage per row within
// that date — output feeds straight into <TrendChart>.
export function computeDailyAverageReadiness(rows: DailyWellnessRow[]): { date: string; value: number }[] {
  const sumByDate = new Map<string, number>();
  const countByDate = new Map<string, number>();
  for (const row of rows) {
    const score = computeReadinessAverage(row);
    sumByDate.set(row.logDate, (sumByDate.get(row.logDate) ?? 0) + score);
    countByDate.set(row.logDate, (countByDate.get(row.logDate) ?? 0) + 1);
  }
  return [...sumByDate.entries()]
    .map(([date, sum]) => ({ date, value: sum / (countByDate.get(date) ?? 1) }))
    .sort((a, b) => a.date.localeCompare(b.date));
}

export interface ActivityBucket {
  weekLabel: string; // "Sep 1"
  count: number;
}

// Workouts logged per calendar week for the `weeksBack` weeks ending on
// (and including) the week containing `asOfDateKey`. Zero-filled and
// oldest-to-newest, same convention as computeMonthlyGrowth
// (business-metrics.ts) — just bucketed by week instead of month.
export function computeWeeklyActivity(
  createdAtDateKeys: string[],
  asOfDateKey: string,
  weeksBack: number
): ActivityBucket[] {
  const asOf = new Date(`${asOfDateKey}T00:00:00`);
  // Start of the week containing asOf (Sunday-anchored).
  const asOfWeekStart = new Date(asOf);
  asOfWeekStart.setDate(asOf.getDate() - asOf.getDay());

  const buckets: ActivityBucket[] = [];
  for (let i = weeksBack - 1; i >= 0; i--) {
    const weekStart = new Date(asOfWeekStart);
    weekStart.setDate(asOfWeekStart.getDate() - i * 7);
    const weekEnd = new Date(weekStart);
    weekEnd.setDate(weekStart.getDate() + 7);

    const label = weekStart.toLocaleDateString("en-US", { month: "short", day: "numeric" });
    const count = createdAtDateKeys.filter((key) => {
      const d = new Date(`${key}T00:00:00`);
      return d.getTime() >= weekStart.getTime() && d.getTime() < weekEnd.getTime();
    }).length;
    buckets.push({ weekLabel: label, count });
  }
  return buckets;
}
