// The plain PROGRAM VIEW on a phone (FitPros is the reference): a stats card, a row of weeks, one card per day of the chosen week, and a bottom sheet with the day's workout. Read-only; no builder,
// no calendar lock by default. Pure helpers, tested.

export interface PlainExercise {
  name: string;
  line: string;
  note: string | null;
  thumbUrl: string | null;
}

export interface PlainDay {
  id: string;
  dayIndex: number;
  title: string;
  dateLabel: string | null;
  isToday: boolean;
  lockedLabel: string | null;
  // The last time the person finished this day (ISO), or null.
  completedAt: string | null;
  exercises: PlainExercise[];
  totalSets: number;
}

export interface PlainWeek {
  weekNumber: number;
  days: PlainDay[];
}

// "3 x 5", "3 x 8-10", or "1 x 60" (seconds) for timed work, from a row's sets.
export function exerciseLine(sets: { target_reps: string | null; target_time_seconds: number | null }[]): string {
  const first = sets[0];
  if (!first) return "";
  if (first.target_time_seconds && first.target_time_seconds > 0) return `${sets.length} × ${first.target_time_seconds}`;
  if (first.target_reps) return `${sets.length} × ${first.target_reps}`;
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

// "Week 1 Day 2" for a day with no name of its own; the coach's name when it has one ("Mobility").
export function dayCardTitle(weekNumber: number, day: PlainDay): string {
  const t = (day.title ?? "").trim();
  return t && !/^day\s*\d*$/i.test(t) ? t : `Week ${weekNumber} Day ${day.dayIndex}`;
}

// "Seated Hip CAR, Bodyweight Squat Holds, ..." (the first few names; the screen cuts it with an ellipsis).
export function previewLine(exercises: { name: string }[]): string {
  return exercises
    .slice(0, 3)
    .map((e) => e.name)
    .join(", ");
}

export function exerciseCountLabel(n: number): string {
  return `${n} ${n === 1 ? "exercise" : "exercises"}`;
}

export function weekIsComplete(week: PlainWeek): boolean {
  return week.days.length > 0 && week.days.every((d) => d.completedAt != null);
}

export function programStats(weeks: PlainWeek[]): { weeks: number; workouts: number; complete: number; percent: number } {
  const days = weeks.flatMap((w) => w.days);
  const complete = days.filter((d) => d.completedAt != null).length;
  return { weeks: weeks.length, workouts: days.length, complete, percent: days.length === 0 ? 0 : Math.round((complete / days.length) * 100) };
}

// "about 1 month ago", "3 days ago", "about 2 hours ago", "just now".
export function agoLabel(iso: string, now: Date): string {
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return "";
  const minutes = Math.max(0, Math.floor((now.getTime() - then) / 60000));
  if (minutes < 2) return "just now";
  if (minutes < 60) return `${minutes} minutes ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `about ${hours} ${hours === 1 ? "hour" : "hours"} ago`;
  const days = Math.floor(hours / 24);
  if (days < 7) return `${days} ${days === 1 ? "day" : "days"} ago`;
  const weeks = Math.floor(days / 7);
  if (days < 30) return `about ${weeks} ${weeks === 1 ? "week" : "weeks"} ago`;
  const months = Math.floor(days / 30);
  if (months < 12) return `about ${months} ${months === 1 ? "month" : "months"} ago`;
  const years = Math.floor(days / 365);
  return `about ${years} ${years === 1 ? "year" : "years"} ago`;
}
