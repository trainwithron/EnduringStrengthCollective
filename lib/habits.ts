// A habit is "due" on a given date if that date's weekday is in the
// habit's configured weekday set (0 = Sunday .. 6 = Saturday, same
// convention as programs.training_days).
export function isHabitDueOn(weekdays: number[], date: Date): boolean {
  return weekdays.includes(date.getDay());
}
