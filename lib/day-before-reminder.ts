import { DEFAULT_CANCELLATION_WINDOW_HOURS } from "@/lib/cancel-window";
import { dateKeyInZone, addDaysToKey } from "@/lib/timezone";

// The day-before reminder (Ron, Nov 20, wave 2 C2): one heads-up timed to the coach's cancel window, not to the clock. It goes out about an hour and a half before
// the late-cancel cutoff (a 24-hour policy: about 25 to 26 hours before the session), so the client still has time to cancel or move it for free. It says until when.
// A coach with no window (0 hours) gets the plain day-before (24 hours). The one-hour reminder is unchanged.
//
// Each booking gets it once per start time: the time it was sent for is kept (bookings.day_before_reminded_for), so a session moved to a new time gets a fresh one
// with no reset anywhere else. A session booked after the moment it would have gone out gets none (the confirmation just told them). Missed until the cutoff passed:
// none (it would only say a free cancel is already over).

export const DAY_BEFORE_LEAD_MINUTES = 90;
// Never closer to the session than this (the one-hour reminder covers that).
export const DAY_BEFORE_MIN_AHEAD_HOURS = 2;

export interface DayBeforeCandidate {
  startAt: string;
  createdAt: string | null;
  remindedFor: string | null;
  windowHours: number | null | undefined;
}

/** The cutoff the reminder is timed to: the coach's window, or 24 hours when the coach has none. */
export function anchorHours(windowHours: number | null | undefined): number {
  const h = windowHours ?? DEFAULT_CANCELLATION_WINDOW_HOURS;
  return h > 0 ? h : DEFAULT_CANCELLATION_WINDOW_HOURS;
}

/** When the free-cancel time ends for this session (the coach's cutoff). */
export function freeCancelUntil(startAt: string, windowHours: number | null | undefined): Date {
  return new Date(new Date(startAt).getTime() - anchorHours(windowHours) * 3600000);
}

/** Is the day-before reminder due for this booking right now? */
export function dayBeforeDue(c: DayBeforeCandidate, now: Date = new Date()): boolean {
  const start = new Date(c.startAt).getTime();
  if (!Number.isFinite(start)) return false;
  if (c.remindedFor && new Date(c.remindedFor).getTime() === start) return false; // already sent for this time
  const cutoff = freeCancelUntil(c.startAt, c.windowHours).getTime();
  const sendAt = cutoff - DAY_BEFORE_LEAD_MINUTES * 60000;
  const t = now.getTime();
  if (start - t < DAY_BEFORE_MIN_AHEAD_HOURS * 3600000) return false;
  if (t < sendAt || t >= cutoff) return false;
  // Booked after the moment it would have gone out: the confirmation already told them.
  if (c.createdAt && new Date(c.createdAt).getTime() > sendAt) return false;
  return true;
}

const clock = (d: Date, timeZone: string) => d.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit", timeZone });
const weekday = (d: Date, timeZone: string) => d.toLocaleDateString("en-US", { weekday: "long", timeZone });

/** "tomorrow at 3:00 PM" / "Friday at 3:00 PM" / "today at 3:00 PM", in the client's own time zone. */
export function whenPhrase(at: Date, timeZone: string, now: Date = new Date()): string {
  const key = dateKeyInZone(timeZone, at);
  const today = dateKeyInZone(timeZone, now);
  const day = key === today ? "today" : key === addDaysToKey(today, 1) ? "tomorrow" : weekday(at, timeZone);
  return `${day} at ${clock(at, timeZone)}`;
}

/** The push and the email say the same: when, with whom, and until when a cancel or move is free. */
export function dayBeforeMessage(opts: { startAt: string; windowHours: number | null | undefined; coachName: string | null | undefined; timeZone: string; now?: Date }): {
  title: string;
  body: string;
} {
  const now = opts.now ?? new Date();
  const start = new Date(opts.startAt);
  const coach = (opts.coachName ?? "").trim().split(/\s+/)[0] || "your coach";
  const until = whenPhrase(freeCancelUntil(opts.startAt, opts.windowHours), opts.timeZone, now);
  const when = whenPhrase(start, opts.timeZone, now);
  return {
    title: when.startsWith("tomorrow") ? "Your session tomorrow" : "Your upcoming session",
    body: `Your session with ${coach} is ${when}. Need to cancel or move it? You can until ${until}.`,
  };
}
