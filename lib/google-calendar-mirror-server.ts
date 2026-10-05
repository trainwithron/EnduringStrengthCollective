import {
  deleteWorkCalendarEvent,
  refreshGoogleCalendarTokens,
  upsertWorkCalendarEvent,
} from "@/lib/google-calendar";

// Mirrors one booking into the coach's Google work calendar, if they have connected one. Used by the browser-triggered route
// (/api/google-calendar/mirror-event, which checks the caller has standing on the booking first) and by the recurring-session
// engine, which runs on the server with the service role. Never throws: a coach without Google, or a failed call, is a quiet
// no-op because the booking itself already happened.
export type MirrorOutcome =
  | { skipped: string }
  | { ok: true; action: "created" | "updated" | "deleted" | "none" }
  | { ok: false; error: string };

export async function mirrorBookingToGoogleCalendar(serviceRole: any, bookingId: string): Promise<MirrorOutcome> {
  const { data: booking } = await serviceRole
    .from("bookings")
    .select("id, coach_id, athlete_id, start_at, end_at, status, google_calendar_event_id")
    .eq("id", bookingId)
    .maybeSingle();
  if (!booking) return { skipped: "booking not found" };

  const { data: connection } = await serviceRole
    .from("google_calendar_connections")
    .select("id, work_calendar_id, status, google_calendar_oauth_tokens ( access_token, refresh_token, expires_at )")
    .eq("coach_id", booking.coach_id)
    .eq("status", "active")
    .maybeSingle();
  if (!connection || !connection.work_calendar_id) return { skipped: "coach hasn't connected Google Calendar" };

  const tokenRow = Array.isArray(connection.google_calendar_oauth_tokens)
    ? connection.google_calendar_oauth_tokens[0]
    : connection.google_calendar_oauth_tokens;
  if (!tokenRow) return { skipped: "no tokens on file" };

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
        await serviceRole.from("bookings").update({ google_calendar_event_id: null }).eq("id", booking.id);
        return { ok: true, action: "deleted" };
      }
      return { ok: true, action: "none" };
    }

    const { data: athleteProfile } = await serviceRole.from("profiles").select("full_name").eq("id", booking.athlete_id).maybeSingle();
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
    return { ok: true, action: booking.google_calendar_event_id ? "updated" : "created" };
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    console.error(`Google Calendar mirror failed for booking ${booking.id}:`, message);
    if (message.includes("refresh")) {
      await serviceRole.from("google_calendar_connections").update({ status: "error" }).eq("id", connection.id);
    }
    return { ok: false, error: message };
  }
}
