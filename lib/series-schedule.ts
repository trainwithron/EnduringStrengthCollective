import { dateKeyInZone, nowInZone, zonedTimeToUtc } from "@/lib/timezone";
import { generateSlotsForDate, resolveBlockedRangesForDate, type AvailabilityWindow } from "@/lib/booking-slots";

// The date math behind recurring sessions. Everything here is pure: given a pattern ("Tuesdays at 6:00 AM, 60 minutes, in the
// coach's time zone"), it says which instants the sessions fall on and which of them clash with something. The wall-clock time
// is kept in the coach's own zone, so "6:00 every Tuesday" stays 6:00 when the clocks change.
//
// Two shapes of series share it:
//   * fixed: a set number of weeks (1 to 52), all booked at once.
//   * ongoing: no end, kept booked a rolling number of weeks ahead (12 by default), topped up daily.

export const MAX_FIXED_WEEKS = 52;
export const DEFAULT_ONGOING_WINDOW_WEEKS = 12;
// Google Calendar only receives sessions inside this many weeks, however far ahead a series is booked.
export const GOOGLE_MIRROR_WEEKS = 12;

export interface Occurrence {
  start: Date;
  end: Date;
}

// Adds whole days to a "YYYY-MM-DD" key using UTC arithmetic only, so it never depends on the machine's own zone.
export function addDaysToDateKey(dateKey: string, days: number): string {
  const [y, m, d] = dateKey.split("-").map(Number);
  const t = new Date(Date.UTC(y, m - 1, d + days));
  return `${t.getUTCFullYear()}-${String(t.getUTCMonth() + 1).padStart(2, "0")}-${String(t.getUTCDate()).padStart(2, "0")}`;
}

// 0 (Sunday) to 6 (Saturday) for a "YYYY-MM-DD" key, the same numbering as availability windows.
export function weekdayOfDateKey(dateKey: string): number {
  const [y, m, d] = dateKey.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d)).getUTCDay();
}

function normalizeTime(t: string): string {
  const [h, m] = t.split(":");
  return `${h.padStart(2, "0")}:${(m ?? "00").padStart(2, "0")}`;
}

// The nth weekly occurrence (0 = the first), as a real instant.
export function occurrenceAt(
  firstDateKey: string,
  startTime: string,
  timezone: string,
  durationMinutes: number,
  weekIndex: number
): Occurrence {
  const dateKey = addDaysToDateKey(firstDateKey, weekIndex * 7);
  const start = zonedTimeToUtc(dateKey, normalizeTime(startTime), timezone);
  return { start, end: new Date(start.getTime() + durationMinutes * 60000) };
}

export function generateFixedOccurrences(opts: {
  firstDateKey: string;
  startTime: string;
  timezone: string;
  durationMinutes: number;
  count: number;
  // Week indexes to leave out (the coach unticked them in the preview).
  skipIndexes?: number[];
  startIndex?: number;
}): Occurrence[] {
  const count = Math.max(0, Math.min(opts.count, MAX_FIXED_WEEKS));
  const skip = new Set(opts.skipIndexes ?? []);
  const out: Occurrence[] = [];
  for (let i = opts.startIndex ?? 0; i < (opts.startIndex ?? 0) + count; i++) {
    if (skip.has(i)) continue;
    out.push(occurrenceAt(opts.firstDateKey, opts.startTime, opts.timezone, opts.durationMinutes, i));
  }
  return out;
}

// For an ongoing series: every pattern occurrence from now up to `windowWeeks` ahead that is not already booked and was not
// skipped on purpose. `existingStarts` and `skippedStarts` are epoch milliseconds. `endsOnDateKey` (optional) stops it.
export function ongoingOccurrencesToCreate(opts: {
  anchorDateKey: string;
  startTime: string;
  timezone: string;
  durationMinutes: number;
  now: Date;
  windowWeeks?: number;
  existingStarts: Set<number>;
  skippedStarts: Set<number>;
  endsOnDateKey?: string | null;
}): Occurrence[] {
  const windowEnd = opts.now.getTime() + (opts.windowWeeks ?? DEFAULT_ONGOING_WINDOW_WEEKS) * 7 * 86400000;
  const out: Occurrence[] = [];
  // Guard: never loop past 5 years of weeks, whatever the inputs.
  for (let i = 0; i < 260; i++) {
    const occ = occurrenceAt(opts.anchorDateKey, opts.startTime, opts.timezone, opts.durationMinutes, i);
    if (occ.start.getTime() > windowEnd) break;
    if (opts.endsOnDateKey && addDaysToDateKey(opts.anchorDateKey, i * 7) > opts.endsOnDateKey) break;
    if (occ.start.getTime() <= opts.now.getTime()) continue;
    const ms = occ.start.getTime();
    if (opts.existingStarts.has(ms) || opts.skippedStarts.has(ms)) continue;
    out.push(occ);
  }
  return out;
}

// The first date, on or after `fromDateKey`, that falls on `weekday`.
export function firstDateOnOrAfter(fromDateKey: string, weekday: number): string {
  const diff = (weekday - weekdayOfDateKey(fromDateKey) + 7) % 7;
  return addDaysToDateKey(fromDateKey, diff);
}

export type ConflictKind = "past" | "taken" | "outside_hours" | "time_off";

export interface ClassifiedOccurrence extends Occurrence {
  index: number;
  // null means it fits. "taken" and "past" cannot be booked; the others are warnings the coach can override.
  conflict: ConflictKind | null;
}

export interface ExceptionRow {
  kind: "one_off" | "recurring";
  startAt: string | null;
  endAt: string | null;
  weekday: number | null;
  startTime: string | null;
  endTime: string | null;
}

// Checks each occurrence against the coach's real calendar: already-booked time (with the buffer between sessions), the past,
// time off, and weekly hours. `busy` is the coach's confirmed sessions and discovery calls.
export function classifyOccurrences(
  occurrences: Occurrence[],
  ctx: {
    now: Date;
    busy: { start: Date; end: Date }[];
    bufferMinutes: number;
    windows: AvailabilityWindow[];
    exceptions: ExceptionRow[];
    timezone: string;
    // When the coach has set no weekly hours at all, "outside hours" says nothing useful, so it is not flagged.
    ignoreWindows?: boolean;
  }
): ClassifiedOccurrence[] {
  const bufferMs = Math.max(0, ctx.bufferMinutes) * 60000;
  return occurrences.map((occ, index) => {
    let conflict: ConflictKind | null = null;
    if (occ.start.getTime() <= ctx.now.getTime()) {
      conflict = "past";
    } else if (ctx.busy.some((b) => occ.start.getTime() < b.end.getTime() + bufferMs && occ.end.getTime() > b.start.getTime() - bufferMs)) {
      conflict = "taken";
    } else {
      // The booking-slots helpers read a Date's local calendar fields, so hand them a noon Date on the coach's own calendar day.
      // That keeps an evening session (which is already "tomorrow" in UTC) on the right day whatever zone this code runs in.
      const [y, m, d] = dateKeyInZone(ctx.timezone, occ.start).split("-").map(Number);
      const dayDate = new Date(y, m - 1, d, 12, 0, 0);
      const blocked = resolveBlockedRangesForDate(dayDate, ctx.exceptions, ctx.timezone);
      if (blocked.some((r) => occ.start < r.end && occ.end > r.start)) {
        conflict = "time_off";
      } else if (!ctx.ignoreWindows && ctx.windows.length > 0 && !generateSlotsForDate(dayDate, ctx.windows, blocked, ctx.timezone).some((slot) => slot.start.getTime() === occ.start.getTime())) {
        conflict = "outside_hours";
      }
    }
    return { ...occ, index, conflict };
  });
}

export function conflictLabel(kind: ConflictKind): string {
  switch (kind) {
    case "past":
      return "Already passed";
    case "taken":
      return "Time already taken";
    case "time_off":
      return "During your time off";
    case "outside_hours":
      return "Outside your weekly hours";
  }
}

// Conflicts that make a date impossible to book. The others are warnings the coach may keep.
export function isBlockingConflict(kind: ConflictKind | null): boolean {
  return kind === "past" || kind === "taken";
}

// Sessions that fall inside the Google Calendar window.
export function withinGoogleMirrorWindow(start: Date, now: Date, weeks: number = GOOGLE_MIRROR_WEEKS): boolean {
  return start.getTime() <= now.getTime() + weeks * 7 * 86400000;
}

// The wall clock a real instant reads in `timezone`: its local "YYYY-MM-DD" and "HH:MM". A series is stored as the first
// session's local date and time, so it can keep that time across daylight saving.
export function wallClockOf(instant: Date, timezone: string): { dateKey: string; time: string } {
  const z = nowInZone(timezone, instant);
  return {
    dateKey: z.toISOString().slice(0, 10),
    time: `${String(z.getUTCHours()).padStart(2, "0")}:${String(z.getUTCMinutes()).padStart(2, "0")}`,
  };
}
