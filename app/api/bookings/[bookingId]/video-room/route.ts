import { NextResponse } from "next/server";
import { createServerClient } from "@/lib/supabase/server";
import { isDailyConfigured, getVideoRoom, createMeetingToken } from "@/lib/daily-video";
import { meetsMinimumAge } from "@/lib/coppa";

const VIDEO_CALL_MINIMUM_AGE = 18;

// Authenticated — same shape as every other API route in this app.
// Deliberately does its own authorization check via a plain SELECT
// through the authenticated client rather than a service-role client:
// bookings_select_own_or_coach RLS already scopes this to real
// participants, so a booking that isn't the caller's own simply returns
// no rows, and there's nothing left to bypass.
export async function POST(request: Request, props: { params: Promise<{ bookingId: string }> }) {
  const params = await props.params;
  if (!isDailyConfigured()) {
    return NextResponse.json({ error: "Video calling isn't configured yet." }, { status: 503 });
  }

  const supabase = await createServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "Not authenticated." }, { status: 401 });
  }

  const { data: booking } = await supabase
    .from("bookings")
    .select("id, coach_id, athlete_id, end_at, session_type, status")
    .eq("id", params.bookingId)
    .maybeSingle();

  if (!booking) {
    return NextResponse.json({ error: "Booking not found." }, { status: 404 });
  }
  if (booking.session_type !== "video") {
    return NextResponse.json({ error: "This session isn't set up for video." }, { status: 400 });
  }
  if (booking.status !== "confirmed") {
    return NextResponse.json({ error: "This session is no longer scheduled." }, { status: 400 });
  }

  // Ron's direct instruction: video calling is 18+ only. Requires
  // positive confirmation of adult status — a missing date of birth
  // (a client who predates the intake flow, or hasn't completed it)
  // is treated as ineligible, not defaulted to allowed. This is the
  // real enforcement point, not just hiding the button in the UI.
  const { data: intake } = await supabase
    .from("client_intake")
    .select("date_of_birth")
    .eq("athlete_id", booking.athlete_id)
    .maybeSingle();
  if (!intake?.date_of_birth || !meetsMinimumAge(intake.date_of_birth, VIDEO_CALL_MINIMUM_AGE, new Date())) {
    return NextResponse.json({ error: "Video calling is only available for clients 18 and older." }, { status: 403 });
  }

  const isOwner = user.id === booking.coach_id;
  const { data: profile } = await supabase.from("profiles").select("full_name").eq("id", user.id).maybeSingle();

  // Buffer past the booking's own end time so a session running long
  // doesn't get cut off mid-call.
  const expUnixSeconds = Math.floor(new Date(booking.end_at).getTime() / 1000) + 30 * 60;

  try {
    const room = await getVideoRoom(booking.id, expUnixSeconds);
    // Idempotent — the room name is deterministic from the booking id,
    // so re-writing the same value on a second join is harmless.
    await supabase
      .from("bookings")
      .update({ video_provider: "daily", video_room_name: room.name })
      .eq("id", booking.id);
    const token = await createMeetingToken(room.name, profile?.full_name ?? "Participant", isOwner);
    return NextResponse.json({ url: room.url, token });
  } catch {
    return NextResponse.json({ error: "Couldn't set up the video room — try again." }, { status: 500 });
  }
}
