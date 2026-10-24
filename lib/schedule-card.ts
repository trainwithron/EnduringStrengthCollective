import { generateSlotsForDate, resolveBlockedRangesForDate, minimumNoticeBlockedRange, customStartOptions, type AvailabilityWindow } from "./booking-slots";
import { fetchSessionMinutes, sessionMinutesFor } from "./availability-windows";
import { dateKeyInZone, addDaysToKey, getGroupCoachTimezone } from "./timezone";
import { buildCreditPicture, fetchBookingCounts } from "./credit-picture";
import { fetchSlotReasons, fullyBookedLine, limitsActive, limitsFromRow } from "./session-caps";

// The Schedule card at the top of a client's Calendar (Ron, Oct 19: "something small, that says like credits available, would you like to schedule?"):
// "4 sessions available" and one button that opens the soonest day in the next 14 with an open time, worked out exactly the way that day's page works
// out its times (the coach's hours, minus time off and the minimum notice). With no open time in 14 days, the button opens the soonest day where the
// client can ask for a different time (request mode); with neither, it opens Messages.

export const SCHEDULE_LOOKAHEAD_DAYS = 14;

export type ScheduleException = Parameters<typeof resolveBlockedRangesForDate>[1][number];

export function sessionsAvailableLine(available: number): string {
  if (available <= 0) return "No sessions left";
  return available === 1 ? "1 session available" : `${available} sessions available`;
}

// Pure. The day page parses its date as `new Date(\`${key}T00:00:00\`)`, so each day here is built the same way.
export function soonestScheduleDays(input: {
  windows: AvailabilityWindow[];
  exceptions: ScheduleException[];
  timezone: string;
  minimumNoticeHours: number;
  bufferMinutes: number;
  requestMode: boolean;
  now?: Date;
  days?: number;
  // The coach's caps / keep-together / lunch (0432): only the times the server would offer count as open. Absent = every time counts, as before.
  isOffered?: (start: Date) => boolean;
}): { openDay: string | null; requestDay: string | null } {
  const now = input.now ?? new Date();
  const todayKey = dateKeyInZone(input.timezone, now);
  const notice = minimumNoticeBlockedRange(now, input.minimumNoticeHours);
  let requestDay: string | null = null;
  for (let i = 0; i < (input.days ?? SCHEDULE_LOOKAHEAD_DAYS); i++) {
    const key = addDaysToKey(todayKey, i);
    const date = new Date(`${key}T00:00:00`);
    const blocked = resolveBlockedRangesForDate(date, input.exceptions, input.timezone);
    if (notice) blocked.push(notice);
    const slots = generateSlotsForDate(date, input.windows, blocked, input.timezone).filter((s) => s.start > now && (!input.isOffered || input.isOffered(s.start)));
    if (slots.length > 0) return { openDay: key, requestDay };
    if (input.requestMode && requestDay === null) {
      const asks = customStartOptions({ date, windows: input.windows, blockedRanges: blocked, bookings: [], bufferMinutes: input.bufferMinutes, timezone: input.timezone }).filter((s) => s.start > now);
      if (asks.length > 0) requestDay = key;
    }
  }
  return { openDay: null, requestDay };
}

export function scheduleCardHref(days: { openDay: string | null; requestDay: string | null }, dayBase: string, messagesHref: string): string {
  if (days.openDay) return `${dayBase}/${days.openDay}`;
  if (days.requestDay) return `${dayBase}/${days.requestDay}#request-different-time`;
  return messagesHref;
}

// The card shows only when the client picks their own times (free or request) and the coach has open hours. Returns null otherwise.
export async function loadScheduleCardHref(
  supabase: any,
  input: { coachId: string; timezone: string; bookingMode: string; dayBase: string; messagesHref: string }
): Promise<string | null> {
  return (await loadScheduleCard(supabase, input))?.href ?? null;
}

// The same, with the one line under it when the coach is full: "Fully booked this week" (Oct 23, the coach's caps).
export async function loadScheduleCard(
  supabase: any,
  input: { coachId: string; timezone: string; bookingMode: string; dayBase: string; messagesHref: string }
): Promise<{ href: string; note: string | null } | null> {
  if (input.bookingMode !== "free" && input.bookingMode !== "request") return null;
  const [{ data: windowRows }, { data: exceptionRows }, { data: policyRow }, sessionIndex] = await Promise.all([
    supabase.from("coach_availability_windows").select("weekday, start_time, end_time, slot_duration_minutes").eq("coach_id", input.coachId),
    supabase.from("coach_availability_exceptions").select("kind, start_at, end_at, weekday, start_time, end_time").eq("coach_id", input.coachId),
    supabase.from("coach_booking_policies").select("buffer_minutes, minimum_notice_hours").eq("coach_id", input.coachId).maybeSingle(),
    fetchSessionMinutes(supabase, [input.coachId]),
  ]);
  if (!windowRows || windowRows.length === 0) return null;
  const windows: AvailabilityWindow[] = windowRows.map((w: any) => ({
    weekday: w.weekday,
    startTime: w.start_time,
    endTime: w.end_time,
    slotDurationMinutes: w.slot_duration_minutes,
    sessionMinutes: sessionMinutesFor(sessionIndex, input.coachId, w),
  }));
  const exceptions: ScheduleException[] = (exceptionRows ?? []).map((e: any) => ({
    kind: e.kind,
    startAt: e.start_at,
    endAt: e.end_at,
    weekday: e.weekday,
    startTime: e.start_time,
    endTime: e.end_time,
  }));
  // The coach's caps / keep-together / lunch: the fortnight's times are checked with the server once, and only what it would offer counts as open.
  let isOffered: ((start: Date) => boolean) | undefined;
  let note: string | null = null;
  const limitsRead = await supabase.from("coach_booking_policies").select("max_sessions_per_week, max_sessions_per_month, keep_together, lunch_start, lunch_end").eq("coach_id", input.coachId).maybeSingle();
  const limits = limitsRead.error ? null : limitsFromRow(limitsRead.data);
  if (limits && limitsActive(limits)) {
    const now = new Date();
    const todayKey = dateKeyInZone(input.timezone, now);
    const candidates: { start: Date; end: Date; key: string }[] = [];
    for (let i = 0; i < SCHEDULE_LOOKAHEAD_DAYS; i++) {
      const key = addDaysToKey(todayKey, i);
      const date = new Date(`${key}T00:00:00`);
      for (const s of generateSlotsForDate(date, windows, resolveBlockedRangesForDate(date, exceptions, input.timezone), input.timezone)) {
        if (s.start > now) candidates.push({ start: s.start, end: new Date(s.start.getTime() + s.durationMinutes * 60000), key });
      }
    }
    const reasons = await fetchSlotReasons(supabase, input.coachId, candidates);
    if (reasons) {
      const ok = new Set(candidates.filter((_, i) => reasons[i] == null).map((c) => c.start.getTime()));
      isOffered = (start) => ok.has(start.getTime());
      // This week's times all refused by a cap: say so on the card.
      const weekEnd = addDaysToKey(todayKey, 7 - new Date(`${todayKey}T00:00:00`).getDay());
      note = fullyBookedLine(reasons.filter((_, i) => candidates[i].key < weekEnd));
    }
  }
  const days = soonestScheduleDays({
    windows,
    exceptions,
    timezone: input.timezone,
    minimumNoticeHours: policyRow?.minimum_notice_hours ?? 0,
    bufferMinutes: policyRow?.buffer_minutes ?? 0,
    requestMode: input.bookingMode === "request",
    isOffered,
  });
  return { href: scheduleCardHref(days, input.dayBase, input.messagesHref), note };
}

// The coach's read-only "View as client" preview: the same card, with the same numbers, decided the same way as the client's own Calendar
// (this group's coach, their booking mode with no row meaning "I schedule everyone", open hours). Null when the client would not see it.
export async function loadPreviewScheduleCard(supabase: any, groupId: string, athleteId: string): Promise<{ available: number; href: string } | null> {
  const { data: coachMembership } = await supabase.from("group_memberships").select("profile_id").eq("group_id", groupId).eq("role", "coach").limit(1).maybeSingle();
  if (!coachMembership) return null;
  const sb = await supabase.from("coach_booking_policies").select("booking_mode").eq("coach_id", coachMembership.profile_id).maybeSingle();
  const bookingMode = sb.error ? "free" : ((sb.data?.booking_mode as string | null) ?? "coach_schedules");
  const timezone = await getGroupCoachTimezone(supabase, groupId);
  const href = await loadScheduleCardHref(supabase, { coachId: coachMembership.profile_id, timezone, bookingMode, dayBase: `/groups/${groupId}/calendar`, messagesHref: `/groups/${groupId}/messages` });
  if (!href) return null;
  const [{ data: creditsRow }, counts] = await Promise.all([
    supabase.from("session_credits").select("balance").eq("athlete_id", athleteId).eq("group_id", groupId).maybeSingle(),
    fetchBookingCounts(supabase, { athleteId, groupId }),
  ]);
  const picture = buildCreditPicture({ balance: creditsRow?.balance ?? 0, booked: counts.get(`${athleteId}:${groupId}`)?.booked ?? 0, toMark: 0 });
  return { available: picture.toBook, href };
}
