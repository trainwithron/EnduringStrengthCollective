// The plain PROGRAM VIEW on a phone: every week of the program, pick the week and the day, see the workout, log it. No builder, no calendar lock by default. Pure helpers, tested.

export interface PlainDay {
  id: string;
  dayIndex: number;
  title: string;
  dateLabel: string | null;
  isToday: boolean;
  lockedLabel: string | null;
  exercises: { name: string; line: string; note: string | null }[];
}

export interface PlainWeek {
  weekNumber: number;
  days: PlainDay[];
}

// "3 x 5", "3 x 8-10", or "2:00" for timed work, from a row's sets.
export function exerciseLine(sets: { target_reps: string | null; target_time_seconds: number | null }[]): string {
  const first = sets[0];
  if (!first) return "";
  if (first.target_time_seconds && first.target_time_seconds > 0) {
    const s = first.target_time_seconds;
    const clock = `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
    return sets.length > 1 ? `${sets.length} x ${clock}` : clock;
  }
  if (first.target_reps) return `${sets.length} x ${first.target_reps}`;
  return `${sets.length} ${sets.length === 1 ? "set" : "sets"}`;
}

const DAY_MS = 86400000;

// The week to open on. With a start date: the week of today's scheduled day, else the week the start date puts today in (counted in whole weeks from the start), kept inside the program's weeks.
// With no start date nothing is "this week": the first week.
export function currentWeekFor(opts: { startDate: string | null; weekNumbers: number[]; todayWeekFromSchedule: number | null; today: Date }): number | null {
  const { startDate, weekNumbers, todayWeekFromSchedule, today } = opts;
  if (!startDate || weekNumbers.length === 0) return null;
  if (todayWeekFromSchedule != null && weekNumbers.includes(todayWeekFromSchedule)) return todayWeekFromSchedule;
  const start = new Date(`${startDate}T00:00:00`);
  if (Number.isNaN(start.getTime())) return null;
  const weeks = Math.floor((today.getTime() - start.getTime()) / (7 * DAY_MS)) + 1;
  const min = Math.min(...weekNumbers);
  const max = Math.max(...weekNumbers);
  return Math.min(max, Math.max(min, weeks));
}

export function defaultWeek(weeks: PlainWeek[], current: number | null): number {
  if (current != null && weeks.some((w) => w.weekNumber === current)) return current;
  return weeks[0]?.weekNumber ?? 1;
}

// Today's day when the schedule marks one in this week, else the first day.
export function defaultDay(week: PlainWeek | undefined): string | null {
  if (!week || week.days.length === 0) return null;
  return (week.days.find((d) => d.isToday) ?? week.days[0]).id;
}

export function dayChipLabel(day: PlainDay): string {
  const named = day.title && !/^day\s*\d+$/i.test(day.title.trim());
  return named ? `Day ${day.dayIndex} · ${day.title.trim()}` : `Day ${day.dayIndex}`;
}
