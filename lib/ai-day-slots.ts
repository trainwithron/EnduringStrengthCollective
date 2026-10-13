// The parts of the AI Program Builder that the browser needs: which day is which, and how many days make a run. Kept apart from lib/ai-day-run.ts, which signs run tokens and so needs the server's crypto.

export const MAX_DAYS_PER_RUN = 40;

export interface DaySlot {
  week: number;
  day: number;
}

// How many days a week has in this program: the most common count among its weeks, else 1.
export function daysPerWeekOf(days: { week: number; day: number }[]): number {
  const counts = new Map<number, number>();
  for (const d of days) counts.set(d.week, Math.max(counts.get(d.week) ?? 0, d.day));
  if (counts.size === 0) return 1;
  const freq = new Map<number, number>();
  for (const n of counts.values()) freq.set(n, (freq.get(n) ?? 0) + 1);
  return [...freq.entries()].sort((a, b) => b[1] - a[1] || b[0] - a[0])[0][0];
}
