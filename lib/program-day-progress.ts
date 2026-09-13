// Program overview cumulative-volume summary — "Day N of M". Pure date
// math: how far into a scheduled program's real calendar span today
// falls, clamped to the program's own start/end so a program that's
// finished (or hasn't started yet) still reports a sane day count instead
// of a negative or out-of-range one.
export interface ProgramDayProgress {
  dayNumber: number;
  totalDays: number;
}

function startOfDay(d: Date): Date {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate());
}

export function computeProgramDayProgress(
  startDate: string,
  lastScheduledDate: Date,
  today: Date
): ProgramDayProgress | null {
  const start = startOfDay(new Date(`${startDate}T00:00:00`));
  const last = startOfDay(lastScheduledDate);
  const totalDays = Math.round((last.getTime() - start.getTime()) / 86400000) + 1;
  if (totalDays < 1) return null;

  const elapsed = Math.round((startOfDay(today).getTime() - start.getTime()) / 86400000) + 1;
  const dayNumber = Math.max(1, Math.min(totalDays, elapsed));
  return { dayNumber, totalDays };
}
