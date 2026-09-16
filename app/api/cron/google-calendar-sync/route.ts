import { NextResponse } from "next/server";
import { createServiceRoleClient } from "@/lib/supabase/service-role";
import { listPersonalCalendarEvents, refreshGoogleCalendarTokens } from "@/lib/google-calendar";

// Daily sync of each connected coach's personal Google Calendar events
// into google_calendar_personal_events, for rendering inside the in-app
// work Calendar. Deliberately once-daily, matching every other cron
// entry in vercel.json — not the session-reminder cron's 15-minute
// cadence, whose */15 schedule this project's real Hobby-tier Vercel
// plan rejected outright at deploy time tonight. A day-old personal
// event cache is an acceptable tradeoff here (unlike a stale booking
// reminder): the coach still sees their own calendar in Google Calendar
// itself in real time, this cache only feeds a secondary in-app view.
const SYNC_WINDOW_DAYS_AHEAD = 30;

export async function GET(request: Request) {
  if (!process.env.CRON_SECRET) {
    return NextResponse.json({ error: "CRON_SECRET isn't configured." }, { status: 503 });
  }
  const authHeader = request.headers.get("authorization");
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
  }

  const supabase = createServiceRoleClient();
  const { data: connections, error: connectionsError } = await supabase
    .from("google_calendar_connections")
    .select("id, google_calendar_oauth_tokens ( access_token, refresh_token, expires_at )")
    .eq("status", "active");

  if (connectionsError) {
    return NextResponse.json({ error: connectionsError.message }, { status: 500 });
  }

  const timeMin = new Date().toISOString();
  const timeMax = new Date(Date.now() + SYNC_WINDOW_DAYS_AHEAD * 24 * 60 * 60 * 1000).toISOString();
  const results: { connectionId: string; ok: boolean; error?: string }[] = [];

  for (const connection of connections ?? []) {
    const tokenRow = Array.isArray(connection.google_calendar_oauth_tokens)
      ? connection.google_calendar_oauth_tokens[0]
      : connection.google_calendar_oauth_tokens;

    if (!tokenRow) {
      results.push({ connectionId: connection.id, ok: false, error: "No tokens on file." });
      continue;
    }

    try {
      let accessToken = tokenRow.access_token;
      const expiresSoon = new Date(tokenRow.expires_at).getTime() - Date.now() < 5 * 60 * 1000;
      if (expiresSoon) {
        const refreshed = await refreshGoogleCalendarTokens(tokenRow.refresh_token);
        accessToken = refreshed.accessToken;
        await supabase
          .from("google_calendar_oauth_tokens")
          .update({
            access_token: refreshed.accessToken,
            refresh_token: refreshed.refreshToken,
            expires_at: refreshed.expiresAt,
            updated_at: new Date().toISOString(),
          })
          .eq("connection_id", connection.id);
      }

      const events = await listPersonalCalendarEvents(accessToken, timeMin, timeMax);
      const rows = events.map((e) => ({
        connection_id: connection.id,
        external_event_id: e.externalEventId,
        title: e.title,
        start_at: e.startAt,
        end_at: e.endAt,
        updated_at: new Date().toISOString(),
      }));

      if (rows.length > 0) {
        const { error: upsertError } = await supabase
          .from("google_calendar_personal_events")
          .upsert(rows, { onConflict: "connection_id,external_event_id" });
        if (upsertError) throw upsertError;
      }

      results.push({ connectionId: connection.id, ok: true });
    } catch (err) {
      const message = err instanceof Error ? err.message : "Unknown error";
      results.push({ connectionId: connection.id, ok: false, error: message });
      if (message.includes("refresh")) {
        await supabase.from("google_calendar_connections").update({ status: "error" }).eq("id", connection.id);
      }
    }
  }

  return NextResponse.json({ synced: results.length, results });
}
