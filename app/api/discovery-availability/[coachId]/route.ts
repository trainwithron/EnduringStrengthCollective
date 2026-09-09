import { NextResponse } from "next/server";
import { createServiceRoleClient } from "@/lib/supabase/service-role";
import { generateSlotsForDate, resolveBlockedRangesForDate } from "@/lib/booking-slots";
import { zonedTimeToUtc, DEFAULT_COACH_TIMEZONE } from "@/lib/timezone";

// Public, unauthenticated endpoint powering the /book/[coachId] prospect
// self-booking page — a stranger has no session to read
// coach_availability_windows/exceptions/bookings through normal RLS (and
// those tables should never gain broad anon SELECT policies just for
// this). This route does the privileged read itself, server-side, and
// hands back only what's safe: the coach's display name and a list of
// open slot start times for one date — never another person's contact
// info, never the raw schedule internals.
export async function GET(request: Request, props: { params: Promise<{ coachId: string }> }) {
  const params = await props.params;
  const { searchParams } = new URL(request.url);
  const date = searchParams.get("date");

  if (!date || !/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    return NextResponse.json({ error: "A date=YYYY-MM-DD query param is required" }, { status: 400 });
  }

  const supabase = createServiceRoleClient();

  const { data: coach } = await supabase
    .from("profiles")
    .select("id, full_name, timezone")
    .eq("id", params.coachId)
    .maybeSingle();

  if (!coach) {
    return NextResponse.json({ error: "Coach not found" }, { status: 404 });
  }

  const timezone = coach.timezone ?? DEFAULT_COACH_TIMEZONE;

  const { data: windowRows } = await supabase
    .from("coach_availability_windows")
    .select("weekday, start_time, end_time, slot_duration_minutes")
    .eq("coach_id", params.coachId);

  const hasAnyAvailability = (windowRows ?? []).length > 0;

  const { data: exceptionRows } = await supabase
    .from("coach_availability_exceptions")
    .select("kind, start_at, end_at, weekday, start_time, end_time")
    .eq("coach_id", params.coachId);

  const targetDate = new Date(`${date}T00:00:00`);
  const windows = (windowRows ?? []).map((w) => ({
    weekday: w.weekday,
    startTime: w.start_time,
    endTime: w.end_time,
    slotDurationMinutes: w.slot_duration_minutes,
  }));
  const blockedRanges = resolveBlockedRangesForDate(
    targetDate,
    (exceptionRows ?? []).map((e) => ({
      kind: e.kind as "one_off" | "recurring",
      startAt: e.start_at,
      endAt: e.end_at,
      weekday: e.weekday,
      startTime: e.start_time,
      endTime: e.end_time,
    })),
    timezone
  );
  const candidateSlots = generateSlotsForDate(targetDate, windows, blockedRanges, timezone);

  // Subtract whatever's already taken — both real client sessions and
  // other prospects' discovery calls — same overlap rule the booking
  // RPCs themselves enforce server-side; this is just the read-side
  // mirror of it so the page doesn't offer a slot that would fail anyway.
  // Bounded in the coach's own zone, not naive UTC midnight — a booking
  // late in the evening in a zone well behind UTC can otherwise fall on
  // the "wrong" UTC calendar day and get missed by this filter.
  const dayStart = zonedTimeToUtc(date, "00:00", timezone);
  const dayEnd = new Date(dayStart.getTime() + 24 * 60 * 60 * 1000);

  const [{ data: existingBookings }, { data: existingDiscoveryBookings }] = await Promise.all([
    supabase
      .from("bookings")
      .select("start_at")
      .eq("coach_id", params.coachId)
      .eq("status", "confirmed")
      .gte("start_at", dayStart.toISOString())
      .lt("start_at", dayEnd.toISOString()),
    supabase
      .from("discovery_bookings")
      .select("start_at")
      .eq("coach_id", params.coachId)
      .eq("status", "confirmed")
      .gte("start_at", dayStart.toISOString())
      .lt("start_at", dayEnd.toISOString()),
  ]);

  const takenTimes = new Set(
    [...(existingBookings ?? []), ...(existingDiscoveryBookings ?? [])].map((b) =>
      new Date(b.start_at).getTime()
    )
  );

  const openSlots = candidateSlots
    .filter((s) => !takenTimes.has(s.start.getTime()))
    .map((s) => ({ start: s.start.toISOString(), durationMinutes: s.durationMinutes }));

  return NextResponse.json({
    coachName: coach.full_name,
    hasAnyAvailability,
    slots: openSlots,
  });
}
