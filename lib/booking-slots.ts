import { zonedTimeToUtc, DEFAULT_COACH_TIMEZONE } from "./timezone";

export interface AvailabilityWindow {
  weekday: number;
  startTime: string; // "HH:MM" or "HH:MM:SS"
  endTime: string;
  // How often a bookable slot starts.
  slotDurationMinutes: number;
  // How long a booked session lasts, when that differs from the step (a 55-minute session in 60-minute slots leaves a 5-minute gap). Null or missing
  // means the same as the step, which is how every window behaved before this setting existed.
  sessionMinutes?: number | null;
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
    // Slots start every slotDurationMinutes; each one lasts sessionMinutes (default: the same). The session has to fit before the window ends.
    const length = w.sessionMinutes && w.sessionMinutes > 0 ? w.sessionMinutes : w.slotDurationMinutes;
    let cursor = new Date(start);
    while (cursor.getTime() + length * 60000 <= end.getTime()) {
      const slotEnd = new Date(cursor.getTime() + length * 60000);
      const blocked = blockedRanges.some((b) => overlaps(cursor, slotEnd, b.start, b.end));
      if (!blocked) {
        slots.push({ start: new Date(cursor), durationMinutes: length });
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

// A time of day. Pass the time zone to show it on that clock: these labels are built on the server, which runs in UTC, so without a
// zone a 6:00 AM Pacific session would read 1:00 PM.
export function formatSlotTime(date: Date, timeZone?: string): string {
  return date.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit", ...(timeZone ? { timeZone } : {}) });
}

// acuity_replacement_gap_audit_sept16.md — minimum-notice booking gap.
// A single BlockedRange covering [now, now + minimumNoticeHours) is the
// cleanest way to fold this into the existing generateSlotsForDate
// pipeline (same mechanism already used for vacations/exceptions) rather
// than adding a second, parallel filtering pass. Returns null when
// there's no notice requirement, so a caller can skip appending it.
export function minimumNoticeBlockedRange(now: Date, minimumNoticeHours: number): BlockedRange | null {
  if (minimumNoticeHours <= 0) return null;
  return { start: now, end: new Date(now.getTime() + minimumNoticeHours * 3600000) };
}

// The real server-side enforcement (book_session/reschedule_booking) is
// the load-bearing check; this mirrors that same predicate for the UI so
// a slot within buffer_minutes of an adjacent confirmed booking can be
// flagged, without removing already-booked slots from the rendered list
// (this app's day-detail pages show every slot with its own booked/open
// status, not just the open ones).
// A session can start at any minute (Ron, Oct 6: "be human, not tied to a system"), so a booking made at 6:20 must block the 6:00 and 6:15 slots even with no
// buffer: this is plain overlap, widened by the buffer when there is one. (It used to say nothing at a buffer of 0, which only worked while every session
// started exactly on a slot.)
export function isSlotBufferBlocked(
  slotStart: Date,
  slotEnd: Date,
  otherBookings: { start: Date; end: Date }[],
  bufferMinutes: number
): boolean {
  return slotConflict(slotStart, slotEnd, otherBookings, bufferMinutes) !== null;
}

// Why a slot cannot be booked, so the words can be right: "taken" when another session overlaps it, "buffer" when it only comes within the buffer of one.
export function slotConflict(
  slotStart: Date,
  slotEnd: Date,
  otherBookings: { start: Date; end: Date }[],
  bufferMinutes: number
): "taken" | "buffer" | null {
  if (otherBookings.some((b) => overlaps(slotStart, slotEnd, b.start, b.end))) return "taken";
  if (bufferMinutes <= 0) return null;
  const bufferMs = bufferMinutes * 60000;
  const near = otherBookings.some((b) =>
    overlaps(slotStart, slotEnd, new Date(b.start.getTime() - bufferMs), new Date(b.end.getTime() + bufferMs))
  );
  return near ? "buffer" : null;
}

export interface CustomStartOption {
  start: Date;
  durationMinutes: number;
}

// The start times a client can ask for beyond the regular slots (request mode, "Ask for a different time"): every `stepMinutes` (5) inside the coach's open hours
// for that day, long enough for the window's session, clear of time off and of other sessions (with the buffer). Regular slot starts are left out because they
// are already offered. Nothing here books anything: the client's pick becomes an ordinary request the coach confirms.
export function customStartOptions(input: {
  date: Date;
  windows: AvailabilityWindow[];
  blockedRanges: BlockedRange[];
  bookings: { start: Date; end: Date }[];
  bufferMinutes: number;
  timezone?: string;
  stepMinutes?: number;
  excludeStarts?: Set<number>;
}): CustomStartOption[] {
  const { date, windows, blockedRanges, bookings, bufferMinutes } = input;
  const timezone = input.timezone ?? DEFAULT_COACH_TIMEZONE;
  const step = input.stepMinutes && input.stepMinutes > 0 ? input.stepMinutes : 5;
  const dateKey = dateKeyOf(date);
  const out = new Map<number, CustomStartOption>();
  for (const w of windows.filter((w) => w.weekday === date.getDay())) {
    const start = zonedTimeToUtc(dateKey, w.startTime, timezone);
    const end = zonedTimeToUtc(dateKey, w.endTime, timezone);
    const length = w.sessionMinutes && w.sessionMinutes > 0 ? w.sessionMinutes : w.slotDurationMinutes;
    for (let cursor = new Date(start); cursor.getTime() + length * 60000 <= end.getTime(); cursor = new Date(cursor.getTime() + step * 60000)) {
      const slotEnd = new Date(cursor.getTime() + length * 60000);
      if (input.excludeStarts?.has(cursor.getTime())) continue;
      if (blockedRanges.some((b) => overlaps(cursor, slotEnd, b.start, b.end))) continue;
      if (slotConflict(cursor, slotEnd, bookings, bufferMinutes) !== null) continue;
      if (!out.has(cursor.getTime())) out.set(cursor.getTime(), { start: new Date(cursor), durationMinutes: length });
    }
  }
  return [...out.values()].sort((a, b) => a.start.getTime() - b.start.getTime());
}

// acuity_replacement_gap_audit_sept16.md — recurring bookings, the
// availability-conflict check (Q4: flag for the coach to resolve rather
// than silently auto-cancel or silently let it double-book). Reuses
// generateSlotsForDate's own real slot-generation directly instead of
// writing separate "does this instant fall in a window" date math — a
// recurring occurrence "still fits" exactly when it's one of the slots
// the coach's current real availability would generate for that date.
export function bookingFitsAvailability(
  bookingStart: Date,
  windows: AvailabilityWindow[],
  blockedRanges: BlockedRange[],
  timezone: string = DEFAULT_COACH_TIMEZONE,
  // Noon of the booking's day ON THE COACH'S CLOCK. The slot helpers read a Date's calendar day and weekday in the machine's own
  // zone (UTC on the server), so an evening session would otherwise be checked against tomorrow's hours.
  dayDate?: Date,
  // With the session's end, "fits" means the whole session sits inside one of the coach's open windows and clear of time off, so a session at any minute
  // (6:20, 1:15) still fits. Without it the old rule applies: the start must be exactly one of the generated slots.
  bookingEnd?: Date
): boolean {
  const day = dayDate ?? bookingStart;
  if (bookingEnd) {
    const dateKey = dateKeyOf(day);
    const inside = windows
      .filter((w) => w.weekday === day.getDay())
      .some((w) => zonedTimeToUtc(dateKey, w.startTime, timezone) <= bookingStart && bookingEnd <= zonedTimeToUtc(dateKey, w.endTime, timezone));
    return inside && !blockedRanges.some((b) => overlaps(bookingStart, bookingEnd, b.start, b.end));
  }
  const slots = generateSlotsForDate(day, windows, blockedRanges, timezone);
  return slots.some((s) => s.start.getTime() === bookingStart.getTime());
}
