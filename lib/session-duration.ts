// How long a workout really took, for any AVERAGE of session lengths (Ron, Oct 23: "I didn't finish a workout ... and now I have like a 17-hour workout. It should be able to know that
// that's not right."). A workout left open and finished hours later (the next morning, or by the nightly job) has a recorded length that is not its length. Pure.
//   * a recorded length over 4 hours, or one that ends on a later day than it started, is not believed;
//   * then the time from the start to the last logged set is used, when the sets carry times and that is believable;
//   * otherwise the workout is left out of the average (null).
export const MAX_PLAUSIBLE_SESSION_SECONDS = 4 * 3600;

const ms = (iso: string | null | undefined): number | null => {
  if (!iso) return null;
  const t = Date.parse(iso);
  return Number.isFinite(t) ? t : null;
};

const believable = (seconds: number | null | undefined): seconds is number => typeof seconds === "number" && seconds > 0 && seconds <= MAX_PLAUSIBLE_SESSION_SECONDS;

/** The day of an instant in a time zone ("2026-10-22"), so "finished the next day" means the coach's next day, not UTC's. */
function dayIn(t: number, timeZone: string): string {
  try {
    return new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date(t));
  } catch {
    return new Date(t).toISOString().slice(0, 10);
  }
}

export function plausibleSessionSeconds(s: {
  startedAt: string | null | undefined;
  completedAt?: string | null;
  durationSeconds: number | null | undefined;
  /** the latest completed_at of the session's logged sets, when known */
  lastSetAt?: string | null;
  timeZone?: string;
}): number | null {
  const start = ms(s.startedAt);
  const end = ms(s.completedAt);
  const tz = s.timeZone ?? "UTC";
  const nextDay = start !== null && end !== null && dayIn(end, tz) > dayIn(start, tz);
  if (believable(s.durationSeconds) && !nextDay) return s.durationSeconds;
  const last = ms(s.lastSetAt);
  if (start !== null && last !== null) {
    const bySets = Math.round((last - start) / 1000);
    if (believable(bySets)) return bySets;
  }
  return null;
}

/** The latest set time among a session's sets (any shape with completed_at). */
export function lastSetTime(sets: { completed_at?: string | null }[]): string | null {
  let best: string | null = null;
  let bestMs = -Infinity;
  for (const x of sets) {
    const t = ms(x.completed_at ?? null);
    if (t !== null && t > bestMs) {
      bestMs = t;
      best = x.completed_at as string;
    }
  }
  return best;
}
