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

// A workout is locked when its computed date hasn't arrived yet — a
// pacing/UX control, not a security boundary (see plan notes on why this
// is page-level, not RLS).
export function isLocked(scheduledDate: Date | undefined, today: Date): boolean {
  if (!scheduledDate) return false;
  const d = new Date(scheduledDate);
  d.setHours(0, 0, 0, 0);
  const t = new Date(today);
  t.setHours(0, 0, 0, 0);
  return d.getTime() > t.getTime();
}
