// A habit is "due" on a given date if that date's weekday is in the
// habit's configured weekday set (0 = Sunday .. 6 = Saturday, same
// convention as programs.training_days).
export function isHabitDueOn(weekdays: number[], date: Date): boolean {
  return weekdays.includes(date.getDay());
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
