import {
  MAX_FIXED_WEEKS,
  DEFAULT_ONGOING_WINDOW_WEEKS,
  addDaysToDateKey,
  classifyOccurrences,
  conflictLabel,
  generateFixedOccurrences,
  isBlockingConflict,
  occurrenceAt,
  ongoingOccurrencesToCreate,
  wallClockOf,
  weekdayOfDateKey,
  withinGoogleMirrorWindow,
  type ClassifiedOccurrence,
  type ConflictKind,
  type ExceptionRow,
  type Occurrence,
} from "@/lib/series-schedule";
import type { AvailabilityWindow } from "@/lib/booking-slots";

// Recurring sessions: create, preview, top up, pause, resume, end, extend, move one, change from here on.
//
// All the real work goes through book_session and cancel_booking_and_refund_credit, the same functions every other booking
// uses, so overlap, buffer and credit rules are not duplicated here. This file only decides WHICH sessions to book or cancel.
// Data access is behind SeriesStore so the decisions can be tested without a database; supabaseSeriesStore (below the
// engine, in lib/series-store.ts) is the real one.

export type SeriesMode = "fixed" | "ongoing";
export type SeriesStatus = "active" | "paused" | "ended" | "cancelled";

export interface SeriesRow {
  id: string;
  coachId: string;
  athleteId: string;
  groupId: string;
  weekday: number;
  startTime: string; // "HH:MM" in the coach's zone
  durationMinutes: number;
  mode: SeriesMode;
  occurrencesTotal: number | null;
  status: SeriesStatus;
  timezone: string | null;
  anchorDate: string | null; // "YYYY-MM-DD", the first session's local date
  windowWeeks: number;
  endsOn: string | null;
  skippedStarts: string[]; // ISO instants
  pausedAt: string | null;
  pausedRemaining: number | null;
}

export type NewSeries = Omit<SeriesRow, "id">;

export interface BookingRow {
  id: string;
  seriesId: string | null;
  coachId: string;
  athleteId: string;
  groupId: string;
  startAt: string;
  endAt: string;
  status: string;
  attendedAt: string | null;
  creditState: string | null;
}

export interface CoachContext {
  timezone: string;
  bufferMinutes: number;
  windows: AvailabilityWindow[];
  exceptions: ExceptionRow[];
}

export interface SeriesStore {
  coachContext(coachId: string): Promise<CoachContext>;
  // The coach's confirmed sessions and discovery calls between two instants.
  busy(coachId: string, from: Date, to: Date): Promise<{ start: Date; end: Date }[]>;
  insertSeries(row: NewSeries): Promise<{ ok: true; value: SeriesRow } | { ok: false; message: string }>;
  getSeries(id: string): Promise<SeriesRow | null>;
  updateSeries(id: string, patch: Partial<Omit<SeriesRow, "id">>): Promise<void>;
  // Confirmed sessions of a series, earliest first.
  seriesBookings(seriesId: string): Promise<BookingRow[]>;
  getBooking(id: string): Promise<BookingRow | null>;
  book(args: { coachId: string; athleteId: string; groupId: string; start: Date; end: Date; seriesId: string }): Promise<
    { ok: true; bookingId: string } | { ok: false; message: string }
  >;
  cancel(bookingId: string): Promise<{ ok: true } | { ok: false; message: string }>;
  // Best effort: Google Calendar and similar. Never throws.
  mirror(bookingId: string): Promise<void>;
}

export interface SeriesInput {
  coachId: string;
  athleteId: string;
  groupId: string;
  firstStartIso: string;
  durationMinutes: number;
  mode: SeriesMode;
  count?: number; // fixed only, 1 to 52
  windowWeeks?: number; // ongoing only
  endsOn?: string | null; // ongoing only, "YYYY-MM-DD"
  // Sessions the coach unticked in the preview.
  skipStartsIso?: string[];
}

export interface PreviewRow {
  startIso: string;
  endIso: string;
  conflict: ConflictKind | null;
  conflictLabel: string | null;
  blocking: boolean;
}

export interface SeriesPreview {
  timezone: string;
  anchorDate: string;
  startTime: string;
  weekday: number;
  rows: PreviewRow[];
  error?: string;
}

function validate(input: SeriesInput): string | null {
  if (!Number.isFinite(input.durationMinutes) || input.durationMinutes < 5 || input.durationMinutes > 480) {
    return "Pick a session length between 5 minutes and 8 hours.";
  }
  if (Number.isNaN(new Date(input.firstStartIso).getTime())) return "Pick a start date and time.";
  if (input.mode === "fixed") {
    const c = input.count ?? 0;
    if (!Number.isInteger(c) || c < 1 || c > MAX_FIXED_WEEKS) return `Choose between 1 and ${MAX_FIXED_WEEKS} weeks.`;
  }
  if (input.mode === "ongoing") {
    const w = input.windowWeeks ?? DEFAULT_ONGOING_WINDOW_WEEKS;
    if (!Number.isInteger(w) || w < 1 || w > 52) return "The booking window has to be between 1 and 52 weeks.";
  }
  return null;
}

async function classify(store: SeriesStore, coachId: string, occurrences: Occurrence[], now: Date, ctx: CoachContext): Promise<ClassifiedOccurrence[]> {
  if (occurrences.length === 0) return [];
  const from = new Date(Math.min(...occurrences.map((o) => o.start.getTime())) - 86400000);
  const to = new Date(Math.max(...occurrences.map((o) => o.end.getTime())) + 86400000);
  const busy = await store.busy(coachId, from, to);
  return classifyOccurrences(occurrences, {
    now,
    busy,
    bufferMinutes: ctx.bufferMinutes,
    windows: ctx.windows,
    exceptions: ctx.exceptions,
    timezone: ctx.timezone,
  });
}

function toPreviewRow(o: ClassifiedOccurrence): PreviewRow {
  return {
    startIso: o.start.toISOString(),
    endIso: o.end.toISOString(),
    conflict: o.conflict,
    conflictLabel: o.conflict ? conflictLabel(o.conflict) : null,
    blocking: isBlockingConflict(o.conflict),
  };
}

function plannedOccurrences(input: SeriesInput, ctx: CoachContext, now: Date): { anchorDate: string; startTime: string; weekday: number; list: Occurrence[] } {
  const wall = wallClockOf(new Date(input.firstStartIso), ctx.timezone);
  const common = { startTime: wall.time, timezone: ctx.timezone, durationMinutes: input.durationMinutes };
  const list =
    input.mode === "fixed"
      ? generateFixedOccurrences({ firstDateKey: wall.dateKey, count: input.count ?? 1, ...common })
      : ongoingOccurrencesToCreate({
          anchorDateKey: wall.dateKey,
          ...common,
          now,
          windowWeeks: input.windowWeeks ?? DEFAULT_ONGOING_WINDOW_WEEKS,
          existingStarts: new Set(),
          skippedStarts: new Set(),
          endsOnDateKey: input.endsOn ?? null,
        });
  return { anchorDate: wall.dateKey, startTime: wall.time, weekday: weekdayOfDateKey(wall.dateKey), list };
}

// What would be booked, and which of those clash with something. Nothing is written.
export async function previewSeries(store: SeriesStore, input: SeriesInput, now: Date = new Date()): Promise<SeriesPreview> {
  const ctx = await store.coachContext(input.coachId);
  const problem = validate(input);
  const plan = plannedOccurrences({ ...input, count: input.count ?? 1 }, ctx, now);
  if (problem) return { timezone: ctx.timezone, anchorDate: plan.anchorDate, startTime: plan.startTime, weekday: plan.weekday, rows: [], error: problem };
  const classified = await classify(store, input.coachId, plan.list, now, ctx);
  return { timezone: ctx.timezone, anchorDate: plan.anchorDate, startTime: plan.startTime, weekday: plan.weekday, rows: classified.map(toPreviewRow) };
}

export interface CreateResult {
  ok: boolean;
  seriesId?: string;
  booked: number;
  // Dates that could not be booked, with why.
  notBooked: { startIso: string; reason: string }[];
  error?: string;
}

export async function createSeries(store: SeriesStore, input: SeriesInput, now: Date = new Date()): Promise<CreateResult> {
  const problem = validate(input);
  if (problem) return { ok: false, booked: 0, notBooked: [], error: problem };

  const ctx = await store.coachContext(input.coachId);
  const plan = plannedOccurrences(input, ctx, now);
  const skip = new Set((input.skipStartsIso ?? []).map((s) => new Date(s).getTime()));
  const classified = await classify(store, input.coachId, plan.list, now, ctx);

  const notBooked: { startIso: string; reason: string }[] = [];
  const toBook: ClassifiedOccurrence[] = [];
  for (const o of classified) {
    if (skip.has(o.start.getTime())) continue;
    if (isBlockingConflict(o.conflict)) {
      notBooked.push({ startIso: o.start.toISOString(), reason: conflictLabel(o.conflict as ConflictKind) });
      continue;
    }
    toBook.push(o);
  }
  if (toBook.length === 0) {
    return { ok: false, booked: 0, notBooked, error: "None of those dates can be booked. Pick another time." };
  }

  const inserted = await store.insertSeries({
    coachId: input.coachId,
    athleteId: input.athleteId,
    groupId: input.groupId,
    weekday: plan.weekday,
    startTime: plan.startTime,
    durationMinutes: input.durationMinutes,
    mode: input.mode,
    occurrencesTotal: input.mode === "fixed" ? input.count ?? null : null,
    status: "active",
    timezone: ctx.timezone,
    anchorDate: plan.anchorDate,
    windowWeeks: input.windowWeeks ?? DEFAULT_ONGOING_WINDOW_WEEKS,
    endsOn: input.mode === "ongoing" ? input.endsOn ?? null : null,
    skippedStarts: [...skip].map((ms) => new Date(ms).toISOString()),
    pausedAt: null,
    pausedRemaining: null,
  });
  if (!inserted.ok) return { ok: false, booked: 0, notBooked, error: inserted.message };
  const series = inserted.value;

  let booked = 0;
  for (const o of toBook) {
    const r = await store.book({ coachId: input.coachId, athleteId: input.athleteId, groupId: input.groupId, start: o.start, end: o.end, seriesId: series.id });
    if (!r.ok) {
      notBooked.push({ startIso: o.start.toISOString(), reason: r.message });
      continue;
    }
    booked += 1;
    if (withinGoogleMirrorWindow(o.start, now)) await store.mirror(r.bookingId);
  }

  if (booked === 0) {
    await store.updateSeries(series.id, { status: "cancelled" });
    return { ok: false, seriesId: series.id, booked: 0, notBooked, error: "None of those dates could be booked." };
  }
  return { ok: true, seriesId: series.id, booked, notBooked };
}

export interface TopUpResult {
  booked: number;
  notBooked: { startIso: string; reason: string }[];
}

// Keeps an ongoing series booked `windowWeeks` ahead. Safe to run every day: it only books what is missing, never a week the
// coach removed or moved on purpose, and never anything while the series is paused or ended.
export async function topUpSeries(store: SeriesStore, seriesId: string, now: Date = new Date()): Promise<TopUpResult> {
  const series = await store.getSeries(seriesId);
  if (!series || series.mode !== "ongoing" || series.status !== "active" || !series.anchorDate) return { booked: 0, notBooked: [] };

  const ctx = await store.coachContext(series.coachId);
  const tz = series.timezone ?? ctx.timezone;
  const existing = await store.seriesBookings(series.id);
  const wanted = ongoingOccurrencesToCreate({
    anchorDateKey: series.anchorDate,
    startTime: series.startTime,
    timezone: tz,
    durationMinutes: series.durationMinutes,
    now,
    windowWeeks: series.windowWeeks,
    existingStarts: new Set(existing.map((b) => new Date(b.startAt).getTime())),
    skippedStarts: new Set(series.skippedStarts.map((s) => new Date(s).getTime())),
    endsOnDateKey: series.endsOn,
  });

  const classified = await classify(store, series.coachId, wanted, now, { ...ctx, timezone: tz });
  const notBooked: { startIso: string; reason: string }[] = [];
  let booked = 0;
  for (const o of classified) {
    if (isBlockingConflict(o.conflict)) {
      notBooked.push({ startIso: o.start.toISOString(), reason: conflictLabel(o.conflict as ConflictKind) });
      continue;
    }
    const r = await store.book({ coachId: series.coachId, athleteId: series.athleteId, groupId: series.groupId, start: o.start, end: o.end, seriesId: series.id });
    if (!r.ok) {
      notBooked.push({ startIso: o.start.toISOString(), reason: r.message });
      continue;
    }
    booked += 1;
    if (withinGoogleMirrorWindow(o.start, now)) await store.mirror(r.bookingId);
  }

  if (series.endsOn && series.endsOn < wallClockOf(now, tz).dateKey) {
    await store.updateSeries(series.id, { status: "ended" });
  }
  return { booked, notBooked };
}

async function cancelFuture(store: SeriesStore, seriesId: string, now: Date, fromIso?: string): Promise<{ cancelled: BookingRow[]; failed: number }> {
  const fromMs = Math.max(fromIso ? new Date(fromIso).getTime() : now.getTime(), now.getTime());
  const bookings = (await store.seriesBookings(seriesId)).filter((b) => new Date(b.startAt).getTime() >= fromMs);
  const cancelled: BookingRow[] = [];
  let failed = 0;
  for (const b of bookings) {
    // A session that already happened (attended or settled) is history, not a future booking.
    if (b.attendedAt || new Date(b.startAt).getTime() <= now.getTime()) continue;
    const r = await store.cancel(b.id);
    if (r.ok) {
      cancelled.push(b);
      await store.mirror(b.id);
    } else {
      failed += 1;
    }
  }
  return { cancelled, failed };
}

export interface ActionResult {
  ok: boolean;
  message: string;
  cancelled?: number;
  booked?: number;
  notBooked?: { startIso: string; reason: string }[];
  seriesId?: string;
}

// Stops new sessions and takes the future ones off the calendar. Resume puts back the same number of weeks.
export async function pauseSeries(store: SeriesStore, seriesId: string, now: Date = new Date()): Promise<ActionResult> {
  const series = await store.getSeries(seriesId);
  if (!series) return { ok: false, message: "That schedule was not found." };
  if (series.status !== "active") return { ok: false, message: "Only a running schedule can be paused." };
  const { cancelled, failed } = await cancelFuture(store, seriesId, now);
  await store.updateSeries(seriesId, { status: "paused", pausedAt: now.toISOString(), pausedRemaining: cancelled.length });
  return {
    ok: true,
    cancelled: cancelled.length,
    message: failed > 0 ? `Paused. ${cancelled.length} upcoming sessions were removed; ${failed} could not be and are still booked.` : `Paused. ${cancelled.length} upcoming sessions were removed.`,
  };
}

export async function resumeSeries(store: SeriesStore, seriesId: string, now: Date = new Date()): Promise<ActionResult> {
  const series = await store.getSeries(seriesId);
  if (!series) return { ok: false, message: "That schedule was not found." };
  if (series.status !== "paused") return { ok: false, message: "That schedule is not paused." };
  if (!series.anchorDate) return { ok: false, message: "This older schedule cannot be resumed. Create a new one." };

  await store.updateSeries(seriesId, { status: "active", pausedAt: null });
  if (series.mode === "ongoing") {
    const r = await topUpSeries(store, seriesId, now);
    await store.updateSeries(seriesId, { pausedRemaining: null });
    return { ok: true, booked: r.booked, notBooked: r.notBooked, message: `Resumed. ${r.booked} sessions booked.` };
  }

  // Fixed: put back the weeks that were removed, starting from the next matching day.
  const ctx = await store.coachContext(series.coachId);
  const tz = series.timezone ?? ctx.timezone;
  const remaining = Math.min(series.pausedRemaining ?? 0, MAX_FIXED_WEEKS);
  const skipped = new Set(series.skippedStarts.map((s) => new Date(s).getTime()));
  const wanted: Occurrence[] = [];
  for (let i = 0; i < 260 && wanted.length < remaining; i++) {
    const occ = occurrenceAt(series.anchorDate, series.startTime, tz, series.durationMinutes, i);
    if (occ.start.getTime() <= now.getTime() || skipped.has(occ.start.getTime())) continue;
    wanted.push(occ);
  }
  const classified = await classify(store, series.coachId, wanted, now, { ...ctx, timezone: tz });
  const notBooked: { startIso: string; reason: string }[] = [];
  let booked = 0;
  for (const o of classified) {
    if (isBlockingConflict(o.conflict)) {
      notBooked.push({ startIso: o.start.toISOString(), reason: conflictLabel(o.conflict as ConflictKind) });
      continue;
    }
    const r = await store.book({ coachId: series.coachId, athleteId: series.athleteId, groupId: series.groupId, start: o.start, end: o.end, seriesId: series.id });
    if (!r.ok) {
      notBooked.push({ startIso: o.start.toISOString(), reason: r.message });
      continue;
    }
    booked += 1;
    if (withinGoogleMirrorWindow(o.start, now)) await store.mirror(r.bookingId);
  }
  await store.updateSeries(seriesId, { pausedRemaining: null });
  return { ok: true, booked, notBooked, message: `Resumed. ${booked} sessions booked.` };
}

// Finishes the schedule. By default the upcoming sessions come off the calendar too.
export async function endSeries(
  store: SeriesStore,
  seriesId: string,
  now: Date = new Date(),
  options: { cancelUpcoming?: boolean } = {}
): Promise<ActionResult> {
  const series = await store.getSeries(seriesId);
  if (!series) return { ok: false, message: "That schedule was not found." };
  if (series.status === "ended" || series.status === "cancelled") return { ok: false, message: "That schedule has already ended." };
  const cancelUpcoming = options.cancelUpcoming ?? true;
  const tz = series.timezone ?? "UTC";
  let cancelled = 0;
  if (cancelUpcoming) cancelled = (await cancelFuture(store, seriesId, now)).cancelled.length;
  await store.updateSeries(seriesId, { status: "ended", endsOn: wallClockOf(now, tz).dateKey });
  return { ok: true, cancelled, message: cancelUpcoming ? `Ended. ${cancelled} upcoming sessions were removed.` : "Ended. Sessions already booked stay on the calendar." };
}

// Fixed schedules only: add weeks to the end.
export async function extendSeries(store: SeriesStore, seriesId: string, extraWeeks: number, now: Date = new Date()): Promise<ActionResult> {
  const series = await store.getSeries(seriesId);
  if (!series) return { ok: false, message: "That schedule was not found." };
  if (series.mode !== "fixed") return { ok: false, message: "A schedule with no end date does not need extending." };
  if (series.status !== "active") return { ok: false, message: "Resume the schedule before extending it." };
  if (!series.anchorDate || series.occurrencesTotal == null) return { ok: false, message: "This older schedule cannot be extended. Create a new one." };
  if (!Number.isInteger(extraWeeks) || extraWeeks < 1) return { ok: false, message: "Choose how many weeks to add." };
  const newTotal = series.occurrencesTotal + extraWeeks;
  if (newTotal > MAX_FIXED_WEEKS) {
    return { ok: false, message: `A schedule can run at most ${MAX_FIXED_WEEKS} weeks. You can add up to ${MAX_FIXED_WEEKS - series.occurrencesTotal} more, or make one with no end.` };
  }

  const ctx = await store.coachContext(series.coachId);
  const tz = series.timezone ?? ctx.timezone;
  const skipped = new Set(series.skippedStarts.map((s) => new Date(s).getTime()));
  const wanted = generateFixedOccurrences({
    firstDateKey: series.anchorDate,
    startTime: series.startTime,
    timezone: tz,
    durationMinutes: series.durationMinutes,
    count: extraWeeks,
    startIndex: series.occurrencesTotal,
  }).filter((o) => !skipped.has(o.start.getTime()));

  const classified = await classify(store, series.coachId, wanted, now, { ...ctx, timezone: tz });
  const notBooked: { startIso: string; reason: string }[] = [];
  let booked = 0;
  for (const o of classified) {
    if (isBlockingConflict(o.conflict)) {
      notBooked.push({ startIso: o.start.toISOString(), reason: conflictLabel(o.conflict as ConflictKind) });
      continue;
    }
    const r = await store.book({ coachId: series.coachId, athleteId: series.athleteId, groupId: series.groupId, start: o.start, end: o.end, seriesId: series.id });
    if (!r.ok) {
      notBooked.push({ startIso: o.start.toISOString(), reason: r.message });
      continue;
    }
    booked += 1;
    if (withinGoogleMirrorWindow(o.start, now)) await store.mirror(r.bookingId);
  }
  await store.updateSeries(seriesId, { occurrencesTotal: newTotal });
  return { ok: true, booked, notBooked, message: `Added ${extraWeeks} weeks. ${booked} sessions booked.` };
}

// Edit ONE session of a schedule: move it to another time. The old time is remembered so the daily top-up never books it back.
export async function moveOccurrence(
  store: SeriesStore,
  bookingId: string,
  newStartIso: string,
  newDurationMinutes: number | null,
  now: Date = new Date()
): Promise<ActionResult> {
  const booking = await store.getBooking(bookingId);
  if (!booking || !booking.seriesId) return { ok: false, message: "That session is not part of a schedule." };
  if (booking.status !== "confirmed") return { ok: false, message: "That session is not on the calendar any more." };
  if (booking.attendedAt || booking.creditState === "settled") return { ok: false, message: "That session already happened." };
  const series = await store.getSeries(booking.seriesId);
  if (!series) return { ok: false, message: "That schedule was not found." };

  const newStart = new Date(newStartIso);
  if (Number.isNaN(newStart.getTime()) || newStart.getTime() <= now.getTime()) return { ok: false, message: "Pick a time in the future." };
  const duration = newDurationMinutes ?? Math.round((new Date(booking.endAt).getTime() - new Date(booking.startAt).getTime()) / 60000);
  const newEnd = new Date(newStart.getTime() + duration * 60000);
  const oldStart = new Date(booking.startAt);
  const oldEnd = new Date(booking.endAt);
  const overlapsOld = newStart < oldEnd && newEnd > oldStart;

  const args = { coachId: booking.coachId, athleteId: booking.athleteId, groupId: booking.groupId, seriesId: series.id };
  let newBookingId: string;
  if (!overlapsOld) {
    const booked = await store.book({ ...args, start: newStart, end: newEnd });
    if (!booked.ok) return { ok: false, message: booked.message.includes("taken") ? "That time is taken." : "That time could not be booked." };
    newBookingId = booked.bookingId;
    const cancelled = await store.cancel(bookingId);
    if (!cancelled.ok) {
      // Put things back rather than leave both sessions on the calendar.
      await store.cancel(newBookingId);
      return { ok: false, message: "The session could not be moved. Nothing was changed." };
    }
  } else {
    const cancelled = await store.cancel(bookingId);
    if (!cancelled.ok) return { ok: false, message: "The session could not be moved. Nothing was changed." };
    const booked = await store.book({ ...args, start: newStart, end: newEnd });
    if (!booked.ok) {
      const restored = await store.book({ ...args, start: oldStart, end: oldEnd });
      if (restored.ok) await store.mirror(restored.bookingId);
      return { ok: false, message: "That time could not be booked. The session stayed where it was." };
    }
    newBookingId = booked.bookingId;
  }

  await store.updateSeries(series.id, { skippedStarts: [...series.skippedStarts, oldStart.toISOString()] });
  await store.mirror(bookingId);
  if (withinGoogleMirrorWindow(newStart, now)) await store.mirror(newBookingId);
  return { ok: true, booked: 1, cancelled: 1, message: "Moved just this session.", seriesId: series.id };
}

// Take ONE session off the calendar without ending the schedule.
export async function skipOccurrence(store: SeriesStore, bookingId: string, now: Date = new Date()): Promise<ActionResult> {
  const booking = await store.getBooking(bookingId);
  if (!booking || !booking.seriesId) return { ok: false, message: "That session is not part of a schedule." };
  if (booking.attendedAt || new Date(booking.startAt).getTime() <= now.getTime()) return { ok: false, message: "That session already happened." };
  const series = await store.getSeries(booking.seriesId);
  if (!series) return { ok: false, message: "That schedule was not found." };
  const r = await store.cancel(bookingId);
  if (!r.ok) return { ok: false, message: "The session could not be removed." };
  await store.updateSeries(series.id, { skippedStarts: [...series.skippedStarts, new Date(booking.startAt).toISOString()] });
  await store.mirror(bookingId);
  return { ok: true, cancelled: 1, message: "Removed just this session. The schedule carries on." };
}

// Edit THIS session and every one after it: new day, time or length. The old schedule ends before this session and a new one
// starts at the new time, with the same number of weeks left (fixed) or no end (ongoing).
export async function changeFromHere(
  store: SeriesStore,
  bookingId: string,
  newFirstStartIso: string,
  newDurationMinutes: number | null,
  now: Date = new Date()
): Promise<ActionResult> {
  const booking = await store.getBooking(bookingId);
  if (!booking || !booking.seriesId) return { ok: false, message: "That session is not part of a schedule." };
  if (booking.attendedAt || booking.creditState === "settled" || new Date(booking.startAt).getTime() <= now.getTime()) {
    return { ok: false, message: "That session already happened." };
  }
  const series = await store.getSeries(booking.seriesId);
  if (!series) return { ok: false, message: "That schedule was not found." };

  const newFirst = new Date(newFirstStartIso);
  if (Number.isNaN(newFirst.getTime()) || newFirst.getTime() <= now.getTime()) return { ok: false, message: "Pick a time in the future." };
  const duration = newDurationMinutes ?? series.durationMinutes;

  const all = await store.seriesBookings(series.id);
  const fromMs = new Date(booking.startAt).getTime();
  const laterCount = all.filter((b) => new Date(b.startAt).getTime() >= fromMs).length;
  const hasEarlier = all.some((b) => new Date(b.startAt).getTime() < fromMs);

  const { cancelled, failed } = await cancelFuture(store, series.id, now, booking.startAt);
  if (failed > 0) return { ok: false, message: `${failed} sessions could not be removed, so the schedule was not changed.`, cancelled: cancelled.length };

  const tz = series.timezone ?? "UTC";
  await store.updateSeries(series.id, {
    status: hasEarlier ? "ended" : "cancelled",
    endsOn: addDaysToDateKey(wallClockOf(new Date(booking.startAt), tz).dateKey, -1),
  });

  const created = await createSeries(
    store,
    {
      coachId: series.coachId,
      athleteId: series.athleteId,
      groupId: series.groupId,
      firstStartIso: newFirst.toISOString(),
      durationMinutes: duration,
      mode: series.mode,
      count: series.mode === "fixed" ? Math.min(Math.max(laterCount, 1), MAX_FIXED_WEEKS) : undefined,
      windowWeeks: series.windowWeeks,
      endsOn: series.endsOn,
    },
    now
  );
  if (!created.ok) {
    return { ok: false, message: created.error ?? "The new times could not be booked.", cancelled: cancelled.length, notBooked: created.notBooked };
  }
  return {
    ok: true,
    seriesId: created.seriesId,
    booked: created.booked,
    cancelled: cancelled.length,
    notBooked: created.notBooked,
    message: `Changed this session and the ones after it. ${created.booked} sessions booked.`,
  };
}
