// A habit is "due" on a given date if that date's weekday is in the
// habit's configured weekday set (0 = Sunday .. 6 = Saturday, same
// convention as programs.training_days).
export function isHabitDueOn(weekdays: number[], date: Date): boolean {
  return weekdays.includes(date.getDay());
}

export interface HabitDef {
  id: string;
  weekdays: number[];
}

export interface HabitLogRow {
  habitId: string;
  logDate: string; // "YYYY-MM-DD"
  completed: boolean;
}

// Aggregate compliance across every active habit over a given window of
// dates — same math as the per-habit breakdown already on the client
// profile page ("Last 7 Days"), just summed rather than kept per-habit.
// Shared so a new consumer (the Milestone Celebrations compound card)
// doesn't have to re-derive this from scratch.
export function computeHabitCompliance(
  habits: HabitDef[],
  logRows: HabitLogRow[],
  windowDates: Date[]
): { totalDue: number; totalCompleted: number } {
  const completedSet = new Set(
    logRows.filter((l) => l.completed).map((l) => `${l.habitId}:${l.logDate}`)
  );
  let totalDue = 0;
  let totalCompleted = 0;
  for (const h of habits) {
    const dueDates = windowDates.filter((d) => isHabitDueOn(h.weekdays, d));
    totalDue += dueDates.length;
    totalCompleted += dueDates.filter((d) =>
      completedSet.has(`${h.id}:${d.toISOString().slice(0, 10)}`)
    ).length;
  }
  return { totalDue, totalCompleted };
}

// Null (not 0) when nothing was ever due — an athlete with no active
// habits shouldn't read as "0% compliant," they just don't have this
// signal at all.
export function computeCompliancePct(totalCompleted: number, totalDue: number): number | null {
  if (totalDue <= 0) return null;
  return Math.round((totalCompleted / totalDue) * 100);
}

const WEEKDAY_ABBREV = ["Su", "Mo", "Tu", "We", "Th", "Fr", "Sa"];

// A compact human label for a habit's recurrence — used anywhere a habit
// would otherwise need to be listed once per matching day (e.g. a whole
// month's worth of identical "due today" rows for a daily habit).
export function habitFrequencyLabel(weekdays: number[]): string {
  const set = new Set(weekdays);
  if (set.size === 7) return "Daily";
  if (set.size === 0) return "Never";
  if (set.size === 5 && [1, 2, 3, 4, 5].every((d) => set.has(d))) return "Weekdays";
  if (set.size === 2 && set.has(0) && set.has(6)) return "Weekends";
  return [...set]
    .sort((a, b) => a - b)
    .map((d) => WEEKDAY_ABBREV[d])
    .join("/");
}
