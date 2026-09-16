import { NextResponse } from "next/server";
import { createServerClient } from "@/lib/supabase/server";
import { createServiceRoleClient } from "@/lib/supabase/service-role";
import {
  deleteWorkCalendarEvent,
  refreshGoogleCalendarTokens,
  upsertWorkCalendarEvent,
} from "@/lib/google-calendar";

// Called fire-and-forget from the browser right after book_session/
// reschedule_booking/cancel_booking_and_refund_credit succeeds (same
// "never block the booking flow on a notification round trip" pattern
// as lib/notify-booking-confirmed.ts) — mirrors that one booking into
// the coach's Google work calendar if they've connected one. A coach
// who hasn't connected Google Calendar makes this a silent no-op, not
// an error; nothing here is a load-bearing part of the booking flow
// itself.
export async function POST(request: Request) {
  const supabase = await createServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized." }, { status: 401 });

  const body = await request.json().catch(() => null);
  const bookingId = body?.bookingId;
  if (typeof bookingId !== "string") {
    return NextResponse.json({ error: "Missing bookingId." }, { status: 400 });
  }

  const serviceRole = createServiceRoleClient();
  const { data: booking } = await serviceRole
    .from("bookings")
    .select("id, coach_id, athlete_id, start_at, end_at, status, google_calendar_event_id")
    .eq("id", bookingId)
    .maybeSingle();
  if (!booking) return NextResponse.json({ skipped: "booking not found" });

  // Real authorization check — this route reaches a coach's stored
  // Google OAuth token via the service-role client, so it must verify
  // the caller actually has standing on this specific booking rather
  // than trusting bookingId alone.
  if (user.id !== booking.coach_id && user.id !== booking.athlete_id) {
    return NextResponse.json({ error: "Not authorized for this booking." }, { status: 403 });
  }

  const { data: connection } = await serviceRole
    .from("google_calendar_connections")
    .select("id, work_calendar_id, status, google_calendar_oauth_tokens ( access_token, refresh_token, expires_at )")
    .eq("coach_id", booking.coach_id)
    .eq("status", "active")
    .maybeSingle();
  if (!connection || !connection.work_calendar_id) {
    return NextResponse.json({ skipped: "coach hasn't connected Google Calendar" });
  }

  const tokenRow = Array.isArray(connection.google_calendar_oauth_tokens)
    ? connection.google_calendar_oauth_tokens[0]
    : connection.google_calendar_oauth_tokens;
  if (!tokenRow) return NextResponse.json({ skipped: "no tokens on file" });

  try {
    let accessToken = tokenRow.access_token;
    const expiresSoon = new Date(tokenRow.expires_at).getTime() - Date.now() < 5 * 60 * 1000;
    if (expiresSoon) {
      const refreshed = await refreshGoogleCalendarTokens(tokenRow.refresh_token);
      accessToken = refreshed.accessToken;
      await serviceRole
        .from("google_calendar_oauth_tokens")
        .update({
          access_token: refreshed.accessToken,
          refresh_token: refreshed.refreshToken,
          expires_at: refreshed.expiresAt,
          updated_at: new Date().toISOString(),
        })
        .eq("connection_id", connection.id);
    }

    if (booking.status === "cancelled") {
      if (booking.google_calendar_event_id) {
        await deleteWorkCalendarEvent(accessToken, connection.work_calendar_id, booking.google_calendar_event_id);
        await serviceRole
          .from("bookings")
          .update({ google_calendar_event_id: null })
          .eq("id", booking.id);
      }
      return NextResponse.json({ ok: true, action: "deleted" });
    }

    const { data: athleteProfile } = await serviceRole
      .from("profiles")
      .select("full_name")
      .eq("id", booking.athlete_id)
      .maybeSingle();
    const title = `${athleteProfile?.full_name ?? "Client"} — Session`;

    const eventId = await upsertWorkCalendarEvent(accessToken, connection.work_calendar_id, {
      existingEventId: booking.google_calendar_event_id,
      title,
      startAt: booking.start_at,
      endAt: booking.end_at,
    });

    if (eventId !== booking.google_calendar_event_id) {
      await serviceRole.from("bookings").update({ google_calendar_event_id: eventId }).eq("id", booking.id);
    }

    return NextResponse.json({ ok: true, action: booking.google_calendar_event_id ? "updated" : "created" });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    console.error(`Google Calendar mirror failed for booking ${booking.id}:`, message);
    if (message.includes("refresh")) {
      await serviceRole.from("google_calendar_connections").update({ status: "error" }).eq("id", connection.id);
    }
    // Never surface this as a booking-flow failure to the caller — the
    // real booking already succeeded before this route was ever called.
    return NextResponse.json({ ok: false, error: message });
  }
}
