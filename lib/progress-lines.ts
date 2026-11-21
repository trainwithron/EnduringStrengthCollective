import type { SeriesPoint } from "@/lib/progress-cards";
import { dateKeyInZone } from "@/lib/progress-periods";
import { estimateOneRepMax } from "@/lib/one-rep-max";
import { countsForProgress } from "@/lib/set-types";

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

// A point on the estimated-max line, with the set it came from.
export interface E1rmPoint extends SeriesPoint {
  weight: number;
  reps: number;
}

// The estimated-max line from the lift's own sets (live finding, Nov 20: the card's number and the "Estimated max" under the table came from two different formulas and
// read as a contradiction). The app's one estimate (lib/one-rep-max.ts, the same score lib/record-set.ts ranks sets by), over counted sets only (no warm-ups or drop
// sets): each day's point is that day's best set, so the line, the card's latest number and the best estimate under the table always agree. A set of more than 8 reps
// gives no estimate, so a light high-rep day adds no point rather than a low one.
export function e1rmSeriesFromSets(sets: { weight: number | null; reps: number | null; setType?: string | null; at: string }[], timeZone: string): E1rmPoint[] {
  const byDay = new Map<string, E1rmPoint>();
  for (const s of sets) {
    if (!countsForProgress(s.setType ?? "working") || s.weight == null || s.reps == null || !(Number(s.weight) > 0) || !s.at) continue;
    const weight = Number(s.weight);
    const reps = Math.floor(Number(s.reps));
    const e = estimateOneRepMax(weight, reps);
    if (e == null) continue;
    const day = dateKeyInZone(s.at, timeZone);
    const had = byDay.get(day);
    if (!had || e > had.value) byDay.set(day, { date: day, value: e, weight, reps });
  }
  return [...byDay.values()].sort((a, b) => a.date.localeCompare(b.date));
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
