import { NextResponse } from "next/server";
import { createServiceRoleClient } from "@/lib/supabase/service-role";
import { sendPushToProfile } from "@/lib/send-push";
import { resolveBlockedRangesForDate, bookingFitsAvailability, type AvailabilityWindow } from "@/lib/booking-slots";
import { DEFAULT_COACH_TIMEZONE, dateKeyInZone } from "@/lib/timezone";
import { formatInTimezone } from "@/lib/format-in-timezone";
import { withCronRun } from "@/lib/cron-monitor";

// acuity_replacement_gap_audit_sept16.md — recurring bookings, Q4's
// confirmed answer: flag a future occurrence for the coach to resolve
// once their own real availability changes, never silently auto-cancel
// a client's committed session or silently let it double-book. Runs
// daily — a coach editing their own availability windows/exceptions
// doesn't need this re-checked within minutes, and this avoids hooking
// into every different availability-editing UI flow individually.
async function handler(request: Request) {
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
  // One summary for each coach per run, not one push per session: a coach who changes their hours could otherwise get dozens at once.
  const flaggedByCoach = new Map<string, { groupId: string; names: Set<string>; count: number }>();
  for (const booking of bookings) {
    const timezone = timezoneByCoach.get(booking.coach_id) ?? DEFAULT_COACH_TIMEZONE;
    const windows = windowsByCoach.get(booking.coach_id) ?? [];
    // A coach with no open hours set at all books people by hand, so nothing "no longer fits": there is nothing to fit.
    if (windows.length === 0) continue;
    const rawExceptions = exceptionsByCoach.get(booking.coach_id) ?? [];
    const bookingDate = new Date(booking.start_at);
    const [dy, dm, dd] = dateKeyInZone(timezone, bookingDate).split("-").map(Number);
    const localNoon = new Date(dy, dm - 1, dd, 12, 0, 0);
    const blockedRanges = resolveBlockedRangesForDate(
      localNoon,
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

    if (!bookingFitsAvailability(bookingDate, windows, blockedRanges, timezone, localNoon)) {
      await supabase.from("bookings").update({ needs_coach_resolution: true }).eq("id", booking.id);
      const entry = flaggedByCoach.get(booking.coach_id) ?? { groupId: booking.group_id, names: new Set<string>(), count: 0 };
      entry.names.add(nameByAthlete.get(booking.athlete_id) ?? "a client");
      entry.count++;
      flaggedByCoach.set(booking.coach_id, entry);
      flaggedCount++;
    }
  }

  for (const [coachId, entry] of flaggedByCoach) {
    const who = [...entry.names].slice(0, 3).join(", ") + (entry.names.size > 3 ? ` and ${entry.names.size - 3} more` : "");
    const body = `${entry.count} recurring session${entry.count === 1 ? "" : "s"} (${who}) no longer fit your available hours. Open the calendar to resolve ${entry.count === 1 ? "it" : "them"}.`;
    await supabase.from("notifications").insert({
      profile_id: coachId,
      group_id: entry.groupId,
      type: "recurring_booking_conflict",
      body,
      link_path: `/groups/${entry.groupId}/calendar`,
    });
    await sendPushToProfile(supabase, coachId, "Recurring sessions need a look", body, `/groups/${entry.groupId}/calendar`);
  }

  return NextResponse.json({ ok: true, flaggedCount });
}

export const GET = withCronRun("flag-recurring-booking-conflicts", handler);
