import { DEFAULT_COACH_TIMEZONE } from "@/lib/timezone";
import { mirrorBookingToGoogleCalendar } from "@/lib/google-calendar-mirror-server";
import type { BookingRow, CoachContext, NewSeries, SeriesRow, SeriesStore } from "@/lib/series-engine";

// The real SeriesStore: reads and writes through the service-role client. The caller (an API route) must already have checked
// that the person acting coaches the group; this file does no authorization of its own. Every booking still goes through
// book_session / cancel_booking_and_refund_credit, which keep their own rules (overlap, buffer, credits).

const NOT_READY = "Recurring schedules are not switched on yet. Try again later.";

function looksLikeMissingSchema(message: string | undefined): boolean {
  if (!message) return false;
  return /column|relation|schema cache|does not exist/i.test(message);
}

function mapSeries(r: any): SeriesRow {
  return {
    id: r.id,
    coachId: r.coach_id,
    athleteId: r.athlete_id,
    groupId: r.group_id,
    weekday: r.weekday,
    startTime: String(r.start_time ?? "").slice(0, 5),
    durationMinutes: r.duration_minutes,
    mode: (r.mode ?? "fixed") as SeriesRow["mode"],
    occurrencesTotal: r.occurrences_total ?? null,
    status: r.status,
    timezone: r.timezone ?? null,
    anchorDate: r.anchor_date ?? null,
    windowWeeks: r.window_weeks ?? 12,
    endsOn: r.ends_on ?? null,
    skippedStarts: (r.skipped_starts ?? []) as string[],
    pausedAt: r.paused_at ?? null,
    pausedRemaining: r.paused_remaining ?? null,
  };
}

function mapBooking(r: any): BookingRow {
  return {
    id: r.id,
    seriesId: r.recurring_series_id ?? null,
    coachId: r.coach_id,
    athleteId: r.athlete_id,
    groupId: r.group_id,
    startAt: r.start_at,
    endAt: r.end_at,
    status: r.status,
    attendedAt: r.attended_at ?? null,
    creditState: r.credit_state ?? null,
  };
}

const BOOKING_COLUMNS = "id, recurring_series_id, coach_id, athlete_id, group_id, start_at, end_at, status, attended_at, credit_state";
const BOOKING_COLUMNS_BASIC = "id, recurring_series_id, coach_id, athlete_id, group_id, start_at, end_at, status";

export function supabaseSeriesStore(db: any): SeriesStore {
  return {
    async coachContext(coachId): Promise<CoachContext> {
      const [{ data: profile }, { data: policy }, { data: windows }, { data: exceptions }] = await Promise.all([
        db.from("profiles").select("timezone").eq("id", coachId).maybeSingle(),
        db.from("coach_booking_policies").select("buffer_minutes").eq("coach_id", coachId).maybeSingle(),
        db.from("coach_availability_windows").select("weekday, start_time, end_time, slot_duration_minutes").eq("coach_id", coachId),
        db.from("coach_availability_exceptions").select("kind, start_at, end_at, weekday, start_time, end_time").eq("coach_id", coachId),
      ]);
      return {
        timezone: profile?.timezone ?? DEFAULT_COACH_TIMEZONE,
        bufferMinutes: policy?.buffer_minutes ?? 0,
        windows: (windows ?? []).map((w: any) => ({
          weekday: w.weekday,
          startTime: w.start_time,
          endTime: w.end_time,
          slotDurationMinutes: w.slot_duration_minutes,
        })),
        exceptions: (exceptions ?? []).map((e: any) => ({
          kind: e.kind,
          startAt: e.start_at,
          endAt: e.end_at,
          weekday: e.weekday,
          startTime: e.start_time,
          endTime: e.end_time,
        })),
      };
    },

    async busy(coachId, from, to) {
      const range = { from: from.toISOString(), to: to.toISOString() };
      const [{ data: sessions }, { data: calls }] = await Promise.all([
        db.from("bookings").select("start_at, end_at").eq("coach_id", coachId).eq("status", "confirmed").lt("start_at", range.to).gt("end_at", range.from),
        db.from("discovery_bookings").select("start_at, end_at").eq("coach_id", coachId).eq("status", "confirmed").lt("start_at", range.to).gt("end_at", range.from),
      ]);
      return [...(sessions ?? []), ...(calls ?? [])].map((r: any) => ({ start: new Date(r.start_at), end: new Date(r.end_at) }));
    },

    async insertSeries(row: NewSeries) {
      const { data, error } = await db
        .from("recurring_booking_series")
        .insert({
          coach_id: row.coachId,
          athlete_id: row.athleteId,
          group_id: row.groupId,
          weekday: row.weekday,
          start_time: row.startTime,
          duration_minutes: row.durationMinutes,
          occurrences_total: row.occurrencesTotal,
          status: row.status,
          mode: row.mode,
          timezone: row.timezone,
          anchor_date: row.anchorDate,
          window_weeks: row.windowWeeks,
          ends_on: row.endsOn,
          skipped_starts: row.skippedStarts,
        })
        .select("*")
        .single();
      if (error || !data) {
        console.error("series insert failed:", error?.message);
        return { ok: false as const, message: looksLikeMissingSchema(error?.message) ? NOT_READY : "The schedule could not be saved." };
      }
      return { ok: true as const, value: mapSeries(data) };
    },

    async getSeries(id) {
      const { data } = await db.from("recurring_booking_series").select("*").eq("id", id).maybeSingle();
      return data ? mapSeries(data) : null;
    },

    async updateSeries(id, patch) {
      const row: Record<string, unknown> = { updated_at: new Date().toISOString() };
      if (patch.status !== undefined) row.status = patch.status;
      if (patch.endsOn !== undefined) row.ends_on = patch.endsOn;
      if (patch.occurrencesTotal !== undefined) row.occurrences_total = patch.occurrencesTotal;
      if (patch.skippedStarts !== undefined) row.skipped_starts = patch.skippedStarts;
      if (patch.pausedAt !== undefined) row.paused_at = patch.pausedAt;
      if (patch.pausedRemaining !== undefined) row.paused_remaining = patch.pausedRemaining;
      await db.from("recurring_booking_series").update(row).eq("id", id);
    },

    async seriesBookings(seriesId) {
      let result = await db.from("bookings").select(BOOKING_COLUMNS).eq("recurring_series_id", seriesId).eq("status", "confirmed").order("start_at", { ascending: true });
      if (result.error) {
        result = await db.from("bookings").select(BOOKING_COLUMNS_BASIC).eq("recurring_series_id", seriesId).eq("status", "confirmed").order("start_at", { ascending: true });
      }
      return (result.data ?? []).map(mapBooking);
    },

    async getBooking(id) {
      let result = await db.from("bookings").select(BOOKING_COLUMNS).eq("id", id).maybeSingle();
      if (result.error) result = await db.from("bookings").select(BOOKING_COLUMNS_BASIC).eq("id", id).maybeSingle();
      return result.data ? mapBooking(result.data) : null;
    },

    async book({ coachId, athleteId, groupId, start, end, seriesId }) {
      const { data: bookingId, error } = await db.rpc("book_session", {
        p_coach_id: coachId,
        p_athlete_id: athleteId,
        p_group_id: groupId,
        p_start_at: start.toISOString(),
        p_end_at: end.toISOString(),
      });
      if (error || !bookingId) {
        return { ok: false as const, message: error?.message?.includes("just taken") ? "Time already taken" : error?.message ?? "Could not book" };
      }
      await db.from("bookings").update({ recurring_series_id: seriesId }).eq("id", bookingId);
      return { ok: true as const, bookingId: bookingId as string };
    },

    async cancel(bookingId) {
      const { error } = await db.rpc("cancel_booking_and_refund_credit", { p_booking_id: bookingId });
      return error ? { ok: false as const, message: error.message } : { ok: true as const };
    },

    async mirror(bookingId) {
      try {
        await mirrorBookingToGoogleCalendar(db, bookingId);
      } catch {
        // Never blocks the schedule.
      }
    },
  };
}
