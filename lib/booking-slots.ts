import { zonedTimeToUtc, DEFAULT_COACH_TIMEZONE } from "./timezone";

export interface AvailabilityWindow {
  weekday: number;
  startTime: string; // "HH:MM" or "HH:MM:SS"
  endTime: string;
  slotDurationMinutes: number;
}

export interface CandidateSlot {
  start: Date;
  durationMinutes: number;
}

// A concrete blocked time range for one specific date — already resolved
// from whichever source (a one-off vacation block, a recurring lunch
// break) into real start/end instants, so the slot generator itself
// never needs to know the difference between the two.
export interface BlockedRange {
  start: Date;
  end: Date;
}

function overlaps(aStart: Date, aEnd: Date, bStart: Date, bEnd: Date): boolean {
  return aStart < bEnd && aEnd > bStart;
}

// "YYYY-MM-DD" from a Date's own calendar components — never toISOString(),
// which reflects UTC and can land on the wrong calendar day depending on
// where this code happens to be running (browser vs. server).
function dateKeyOf(date: Date): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(
    date.getDate()
  ).padStart(2, "0")}`;
}

// Pure — generates candidate slots for one calendar date from a coach's
// recurring weekly windows, minus anything inside blockedRanges (vacation,
// a one-off appointment, a recurring lunch break). Doesn't know what's
// already booked; the caller filters those out separately.
//
// `timezone` is the coach's own IANA zone (profiles.timezone) — start_time/
// end_time are the coach's local wall-clock hours, and must be converted
// against *their* zone, not whatever machine happens to run this code
// (previously plain `date.setHours(...)`, which is always local-to-the-
// runtime: the browser's zone in a client component, but UTC on every
// server-rendered page and API route, since Vercel's server clock is UTC).
// Defaults to DEFAULT_COACH_TIMEZONE only for a coach who hasn't set one
// yet — every real call site should pass the coach's actual value once
// they have one.
export function generateSlotsForDate(
  date: Date,
  windows: AvailabilityWindow[],
  blockedRanges: BlockedRange[] = [],
  timezone: string = DEFAULT_COACH_TIMEZONE
): CandidateSlot[] {
  const slots: CandidateSlot[] = [];
  const dateKey = dateKeyOf(date);
  for (const w of windows.filter((w) => w.weekday === date.getDay())) {
    const start = zonedTimeToUtc(dateKey, w.startTime, timezone);
    const end = zonedTimeToUtc(dateKey, w.endTime, timezone);
    let cursor = new Date(start);
    while (cursor.getTime() + w.slotDurationMinutes * 60000 <= end.getTime()) {
      const slotEnd = new Date(cursor.getTime() + w.slotDurationMinutes * 60000);
      const blocked = blockedRanges.some((b) => overlaps(cursor, slotEnd, b.start, b.end));
      if (!blocked) {
        slots.push({ start: new Date(cursor), durationMinutes: w.slotDurationMinutes });
      }
      cursor = new Date(cursor.getTime() + w.slotDurationMinutes * 60000);
    }
  }
  return slots.sort((a, b) => a.start.getTime() - b.start.getTime());
}

// Resolves a coach's saved exceptions (mixed one-off and recurring rows)
// into concrete BlockedRange instants for one specific calendar date —
// the shape generateSlotsForDate actually needs. One-off exceptions are
// already real timestamptz instants (no zone math needed); a recurring
// exception's time-of-day needs the same coach-timezone conversion as the
// availability windows themselves.
export function resolveBlockedRangesForDate(
  date: Date,
  exceptions: {
    kind: "one_off" | "recurring";
    startAt: string | null;
    endAt: string | null;
    weekday: number | null;
    startTime: string | null;
    endTime: string | null;
  }[],
  timezone: string = DEFAULT_COACH_TIMEZONE
): BlockedRange[] {
  const dateKey = dateKeyOf(date);
  const dayStart = zonedTimeToUtc(dateKey, "00:00", timezone);
  const dayEnd = new Date(dayStart.getTime() + 24 * 60 * 60 * 1000);

  const ranges: BlockedRange[] = [];
  for (const ex of exceptions) {
    if (ex.kind === "one_off" && ex.startAt && ex.endAt) {
      const start = new Date(ex.startAt);
      const end = new Date(ex.endAt);
      if (start < dayEnd && end > dayStart) {
        ranges.push({
          start: start < dayStart ? dayStart : start,
          end: end > dayEnd ? dayEnd : end,
        });
      }
    } else if (ex.kind === "recurring" && ex.weekday === date.getDay() && ex.startTime && ex.endTime) {
      ranges.push({
        start: zonedTimeToUtc(dateKey, ex.startTime, timezone),
        end: zonedTimeToUtc(dateKey, ex.endTime, timezone),
      });
    }
  }
  return ranges;
}

export function formatSlotTime(date: Date): string {
  return date.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" });
}
