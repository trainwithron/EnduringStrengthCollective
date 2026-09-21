import { NextResponse } from "next/server";
import { createServiceRoleClient } from "@/lib/supabase/service-role";
import { sendPushToProfile } from "@/lib/send-push";
import { resolveBlockedRangesForDate, bookingFitsAvailability, type AvailabilityWindow } from "@/lib/booking-slots";
import { DEFAULT_COACH_TIMEZONE } from "@/lib/timezone";

// acuity_replacement_gap_audit_sept16.md — recurring bookings, Q4's
// confirmed answer: flag a future occurrence for the coach to resolve
// once their own real availability changes, never silently auto-cancel
// a client's committed session or silently let it double-book. Runs
// daily — a coach editing their own availability windows/exceptions
// doesn't need this re-checked within minutes, and this avoids hooking
// into every different availability-editing UI flow individually.
export async function GET(request: Request) {
  if (!process.env.CRON_SECRET) {
    return NextResponse.json({ error: "CRON_SECRET isn't configured." }, { status: 503 });
  }
  const authHeader = request.headers.get("authorization");
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
  }

  const supabase = createServiceRoleClient();

  const { data: bookings } = await supabase
    .from("bookings")
    .select("id, coach_id, athlete_id, group_id, start_at")
    .not("recurring_series_id", "is", null)
    .eq("status", "confirmed")
    .eq("needs_coach_resolution", false)
    .gt("start_at", new Date().toISOString());

  if (!bookings || bookings.length === 0) {
    return NextResponse.json({ ok: true, flaggedCount: 0 });
  }

  const coachIds = Array.from(new Set(bookings.map((b) => b.coach_id)));
  const athleteIds = Array.from(new Set(bookings.map((b) => b.athlete_id)));

  const [{ data: coachProfiles }, { data: athleteProfiles }, { data: windowRows }, { data: exceptionRows }] =
    await Promise.all([
      supabase.from("profiles").select("id, timezone").in("id", coachIds),
      supabase.from("profiles").select("id, full_name").in("id", athleteIds),
      supabase
        .from("coach_availability_windows")
        .select("coach_id, weekday, start_time, end_time, slot_duration_minutes")
        .in("coach_id", coachIds),
      supabase
        .from("coach_availability_exceptions")
        .select("coach_id, kind, start_at, end_at, weekday, start_time, end_time")
        .in("coach_id", coachIds),
    ]);

  const timezoneByCoach = new Map((coachProfiles ?? []).map((p) => [p.id, p.timezone ?? DEFAULT_COACH_TIMEZONE]));
  const nameByAthlete = new Map((athleteProfiles ?? []).map((p) => [p.id, p.full_name as string]));

  const windowsByCoach = new Map<string, AvailabilityWindow[]>();
  for (const w of windowRows ?? []) {
    const list = windowsByCoach.get(w.coach_id) ?? [];
    list.push({
      weekday: w.weekday,
      startTime: w.start_time,
      endTime: w.end_time,
      slotDurationMinutes: w.slot_duration_minutes,
    });
    windowsByCoach.set(w.coach_id, list);
  }

  const exceptionsByCoach = new Map<string, typeof exceptionRows>();
  for (const e of exceptionRows ?? []) {
    const list = exceptionsByCoach.get(e.coach_id) ?? [];
    list.push(e);
    exceptionsByCoach.set(e.coach_id, list);
  }

  let flaggedCount = 0;
  for (const booking of bookings) {
    const timezone = timezoneByCoach.get(booking.coach_id) ?? DEFAULT_COACH_TIMEZONE;
    const windows = windowsByCoach.get(booking.coach_id) ?? [];
    const rawExceptions = exceptionsByCoach.get(booking.coach_id) ?? [];
    const bookingDate = new Date(booking.start_at);
    const blockedRanges = resolveBlockedRangesForDate(
      bookingDate,
      rawExceptions.map((e) => ({
        kind: e.kind as "one_off" | "recurring",
        startAt: e.start_at,
        endAt: e.end_at,
        weekday: e.weekday,
        startTime: e.start_time,
        endTime: e.end_time,
      })),
      timezone
    );

    if (!bookingFitsAvailability(bookingDate, windows, blockedRanges, timezone)) {
      await supabase.from("bookings").update({ needs_coach_resolution: true }).eq("id", booking.id);
      const athleteName = nameByAthlete.get(booking.athlete_id) ?? "a client";
      const body = `A recurring booking for ${athleteName} on ${bookingDate.toLocaleDateString()} no longer fits your available hours — resolve it.`;
      await supabase.from("notifications").insert({
        profile_id: booking.coach_id,
        group_id: booking.group_id,
        type: "recurring_booking_conflict",
        body,
        link_path: `/groups/${booking.group_id}/calendar`,
      });
      await sendPushToProfile(supabase, booking.coach_id, "Recurring booking conflict", body, `/groups/${booking.group_id}/calendar`);
      flaggedCount++;
    }
  }

  return NextResponse.json({ ok: true, flaggedCount });
}
