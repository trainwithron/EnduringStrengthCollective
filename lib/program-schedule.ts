// Derives real calendar dates for a program's workouts on demand, from an
// anchor start date + which weekdays are training days. Never persisted —
// see the plan notes on why this is computed at read-time instead of
// written into workouts.scheduled_date.
export function computeScheduledDates(
  startDate: string, // programs.start_date, "YYYY-MM-DD"
  trainingDays: number[], // programs.training_days, 0 (Sun) .. 6 (Sat)
  workoutsInOrder: { id: string }[] // already ordered by week_number, day_index
): Map<string, Date> {
  const result = new Map<string, Date>();
  if (workoutsInOrder.length === 0 || trainingDays.length === 0) return result;

  const trainingSet = new Set(trainingDays);
  const cursor = new Date(`${startDate}T00:00:00`);
  let i = 0;
  while (i < workoutsInOrder.length) {
    if (trainingSet.has(cursor.getDay())) {
      result.set(workoutsInOrder[i].id, new Date(cursor));
      i++;
    }
    cursor.setDate(cursor.getDate() + 1);
  }
  return result;
}

// A sensible default weekday spread for "this program trains N days a
// week" — used to auto-schedule a program that has no explicit day
// preference from the coach (currently: AI/import-generated programs,
// which otherwise land with no start_date/training_days at all and
// never resolve as "today's workout" or show on the calendar until a
// coach manually configures them, unlike a manually-created program
// which at least becomes the group's active program by default).
// Spread evenly with rest days between hard training days rather than
// clustering at the start of the week — the same rest-day-spacing
// intuition a coach would apply by hand for 1-6 days/week; 7 trains
// every day since there's no day left to rest on, deliberately.
const DEFAULT_TRAINING_DAYS_BY_COUNT: Record<number, number[]> = {
  1: [1], // Mon
  2: [1, 4], // Mon, Thu
  3: [1, 3, 5], // Mon, Wed, Fri
  4: [1, 2, 4, 5], // Mon, Tue, Thu, Fri
  5: [1, 2, 3, 4, 5], // Mon-Fri
  6: [1, 2, 3, 4, 5, 6], // Mon-Sat
  7: [0, 1, 2, 3, 4, 5, 6], // every day
};

export function defaultTrainingDaysForCount(daysPerWeek: number): number[] | null {
  return DEFAULT_TRAINING_DAYS_BY_COUNT[daysPerWeek] ?? null;
}

export function formatShortDate(date: Date): string {
  return date.toLocaleDateString("en-US", {
    weekday: "short",
    month: "short",
    day: "numeric",
  });
}

export function isSameDay(a: Date, b: Date): boolean {
  return (
    a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate()
  );
}

export type VisibilityWindow = "day" | "week" | "month" | "full";

// How many days beyond today each window opens up. "day" is the original
// behavior (only today and earlier are unlocked) — kept as the default so
// every existing call site behaves exactly as before unless a program
// explicitly opts into a wider window.
const WINDOW_DAYS: Record<VisibilityWindow, number> = {
  day: 0,
  week: 7,
  month: 30,
  full: Infinity,
};

// A workout is locked when its computed date is further out than the
// program's visibility window allows — a pacing/UX control, not a
// security boundary (see plan notes on why this is page-level, not RLS).
export function isLocked(
  scheduledDate: Date | undefined,
  today: Date,
  window: VisibilityWindow = "day"
): boolean {
  if (!scheduledDate) return false;
  if (window === "full") return false;
  const cutoff = new Date(today);
  cutoff.setHours(0, 0, 0, 0);
  cutoff.setDate(cutoff.getDate() + WINDOW_DAYS[window]);
  const d = new Date(scheduledDate);
  d.setHours(0, 0, 0, 0);
  return d.getTime() > cutoff.getTime();
}
