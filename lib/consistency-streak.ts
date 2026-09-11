import { getWeekRange, isWithinRange } from "./week-range";

// Consecutive calendar weeks (Sunday-Saturday) with at least one
// completed workout, counting backward from the week containing `asOf`.
// Weeks, not days — works identically whether an athlete trains 2x or
// 5x a week, and needs no program schedule to exist at all (unlike a
// "days without a missed scheduled session" definition).
export function computeWeekStreak(logDates: Date[], asOf: Date, maxWeeksBack = 104): number {
  let streak = 0;
  let cursor = new Date(asOf);

  for (let i = 0; i < maxWeeksBack; i++) {
    const { start, end } = getWeekRange(cursor);
    const hasLog = logDates.some((d) => isWithinRange(d, start, end));
    if (!hasLog) break;
    streak++;
    cursor = new Date(start);
    cursor.setDate(cursor.getDate() - 1); // step into the previous week
  }

  return streak;
}
