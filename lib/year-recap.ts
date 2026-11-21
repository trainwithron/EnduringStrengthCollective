// The December recap (wave 2, P7; Ron, Nov 20): the client's own year in a few private share pictures, free, from live data, shared only by the client (no public
// page or link by default; Ron's Oct 6 decision closed the public journey page). Needs at least 10 workouts in the year, the way the best-liked recaps do. Pure:
// the caller reads the client's own workout logs and lifts; nothing here reads or writes.

export const RECAP_MIN_WORKOUTS = 10;

export interface RecapLog {
  createdAt: string; // ISO
  totalVolume: number | null;
  totalSets: number | null;
  durationSeconds: number | null;
  newPrs: string[] | null;
}

export interface RecapLift {
  name: string;
  sessions: number; // workouts it was in this year
}

export interface YearRecap {
  year: number;
  workouts: number;
  volume: number; // pounds lifted (weight × reps), as stored
  sets: number;
  minutes: number;
  prCount: number;
  prLifts: string[]; // the lifts with a record this year, most records first
  bestMonth: { month: number; workouts: number } | null; // month 1-12
  longestWeekStreak: number; // most weeks in a row with at least one workout
  topLifts: RecapLift[]; // most trained, up to 3
}

/** The recap is offered from Dec 1 through Jan 15 (in the person's time zone), for the year that is ending or just ended. Null the rest of the year. */
export function recapYearFor(todayKey: string): number | null {
  const y = Number(todayKey.slice(0, 4));
  const m = Number(todayKey.slice(5, 7));
  const d = Number(todayKey.slice(8, 10));
  if (m === 12) return y;
  if (m === 1 && d <= 15) return y - 1;
  return null;
}

// The Monday of the week a date key falls in, as a day number (days since 1970), for counting weeks in a row.
function mondayNumber(key: string): number {
  const t = Date.UTC(Number(key.slice(0, 4)), Number(key.slice(5, 7)) - 1, Number(key.slice(8, 10))) / 86400000;
  const dow = (new Date(t * 86400000).getUTCDay() + 6) % 7; // Monday 0
  return t - dow;
}

/**
 * The year in numbers. `dateKeyOf` turns a log's time into the person's own day (YYYY-MM-DD) so a workout late on Dec 31 counts in the right year.
 * Null when the year has fewer than RECAP_MIN_WORKOUTS workouts (no recap: not enough to say).
 */
export function yearRecap(year: number, logs: RecapLog[], lifts: RecapLift[], dateKeyOf: (iso: string) => string): YearRecap | null {
  const inYear = logs.map((l) => ({ ...l, day: dateKeyOf(l.createdAt) })).filter((l) => l.day.startsWith(`${year}-`));
  if (inYear.length < RECAP_MIN_WORKOUTS) return null;

  const byMonth = new Map<number, number>();
  const prTally = new Map<string, { name: string; count: number }>();
  let volume = 0;
  let sets = 0;
  let seconds = 0;
  let prCount = 0;
  for (const l of inYear) {
    const m = Number(l.day.slice(5, 7));
    byMonth.set(m, (byMonth.get(m) ?? 0) + 1);
    volume += Number(l.totalVolume ?? 0);
    sets += Number(l.totalSets ?? 0);
    seconds += Number(l.durationSeconds ?? 0);
    for (const name of l.newPrs ?? []) {
      const key = name.trim().toLowerCase();
      if (!key) continue;
      prCount++;
      const t = prTally.get(key) ?? { name: name.trim(), count: 0 };
      t.count++;
      prTally.set(key, t);
    }
  }

  let bestMonth: YearRecap["bestMonth"] = null;
  for (const [month, workouts] of byMonth) if (!bestMonth || workouts > bestMonth.workouts || (workouts === bestMonth.workouts && month < bestMonth.month)) bestMonth = { month, workouts };

  const weeks = [...new Set(inYear.map((l) => mondayNumber(l.day)))].sort((a, b) => a - b);
  let longest = 0;
  let run = 0;
  for (let i = 0; i < weeks.length; i++) {
    run = i > 0 && weeks[i] - weeks[i - 1] === 7 ? run + 1 : 1;
    longest = Math.max(longest, run);
  }

  return {
    year,
    workouts: inYear.length,
    volume: Math.round(volume),
    sets,
    minutes: Math.round(seconds / 60),
    prCount,
    prLifts: [...prTally.values()].sort((a, b) => b.count - a.count || a.name.localeCompare(b.name)).map((t) => t.name),
    bestMonth,
    longestWeekStreak: longest,
    topLifts: lifts
      .filter((l) => l.sessions > 0 && l.name.trim())
      .sort((a, b) => b.sessions - a.sessions || a.name.localeCompare(b.name))
      .slice(0, 3),
  };
}

const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
export function monthName(month: number): string {
  return MONTHS[month - 1] ?? "";
}
