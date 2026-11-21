import type { SeriesPoint } from "@/lib/progress-cards";
import { dateKeyInZone } from "@/lib/progress-periods";

// The lines on My progress (wave 2, P1): pure, shared by the server loader (lib/my-progress.ts) and the screen.

// The estimated-max line of one lift from the rollup (its per-workout best estimate), one point a day, oldest first.
export function e1rmSeriesFor(rollup: { exerciseName: string; at: string; bestE1rm: number | null }[], name: string, timeZone: string): SeriesPoint[] {
  const key = name.trim().toLowerCase();
  const byDay = new Map<string, number>();
  for (const r of rollup) {
    if (r.exerciseName.trim().toLowerCase() !== key || r.bestE1rm == null || !(r.bestE1rm > 0)) continue;
    const day = dateKeyInZone(r.at, timeZone);
    byDay.set(day, Math.max(byDay.get(day) ?? 0, r.bestE1rm));
  }
  return [...byDay.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([date, value]) => ({ date, value }));
}

// "+20 lb in 12 weeks": how much a line rose (or fell) over the last weeks, from the last point on or before that many weeks ago (else the first point) to the latest.
// Null with fewer than two points.
export function changeOver(series: SeriesPoint[], todayKey: string, weeks = 12): { delta: number; since: string; fullWindow: boolean } | null {
  if (series.length < 2) return null;
  const sorted = [...series].sort((a, b) => a.date.localeCompare(b.date));
  const startKey = dateKeyInZone(new Date(Date.parse(`${todayKey}T12:00:00Z`) - weeks * 7 * 86400000).toISOString(), "UTC");
  const before = sorted.filter((p) => p.date <= startKey);
  const from = before.length > 0 ? before[before.length - 1] : sorted[0];
  const to = sorted[sorted.length - 1];
  if (from === to) return null;
  return { delta: Number((to.value - from.value).toFixed(1)), since: from.date, fullWindow: before.length > 0 };
}
