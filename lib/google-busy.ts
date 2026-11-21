import { createServiceRoleClient } from "@/lib/supabase/service-role";
import { fetchFreeBusy, isGoogleCalendarConfigured, refreshGoogleCalendarTokens } from "@/lib/google-calendar";
import { openToken, sealedTokenColumns, tokenOwner } from "@/lib/token-crypto";

// A coach's personal Google Calendar blocks booking times (Ron, Nov 20, wave 2 C4). Through the Google connection the coach already made (Settings > Calendar), the coach's own
// calendar is asked, at the moment a booking screen lists times, when they are busy: start and end only. Nothing is stored and no event's title or details are read. A client is
// never told why a time is not offered. Anything that goes wrong (no connection, an expired one, Google slow or down) means no Google times: the screen offers as it did before.
// Used where a CLIENT or a visitor is offered times: the client's day page (lib/coach-busy.ts) and the public booking page (lib/public-booking-store.ts). A coach booking a client
// sees every time, as before (they know their own day).

export type GoogleBusy = { id: string; start: Date; end: Date };

// Google is asked for no more than this long; past it the screen goes on without Google's times.
export const GOOGLE_BUSY_TIMEOUT_MS = 2500;

export async function googleBusyRanges(coachId: string, fromIso: string, toIso: string): Promise<GoogleBusy[]> {
  if (!isGoogleCalendarConfigured()) return [];
  try {
    const db = createServiceRoleClient();
    const { data: connection } = await db
      .from("google_calendar_connections")
      .select("id, coach_id, google_calendar_oauth_tokens ( access_token, refresh_token, expires_at )")
      .eq("coach_id", coachId)
      .eq("status", "active")
      .limit(1)
      .maybeSingle();
    if (!connection) return [];
    const raw = (connection as { google_calendar_oauth_tokens?: unknown }).google_calendar_oauth_tokens;
    const tokens = (Array.isArray(raw) ? raw[0] : raw) as { access_token: string; refresh_token: string; expires_at: string } | null;
    if (!tokens) return [];
    const owner = tokenOwner("calendar", "google", coachId);
    let accessToken = openToken(tokens.access_token, owner, "access");
    // An access token about to run out is renewed and kept (the same way the nightly sync does).
    if (new Date(tokens.expires_at).getTime() - Date.now() < 5 * 60 * 1000) {
      const refreshed = await refreshGoogleCalendarTokens(openToken(tokens.refresh_token, owner, "refresh"));
      accessToken = refreshed.accessToken;
      await db
        .from("google_calendar_oauth_tokens")
        .update({ ...sealedTokenColumns(refreshed, owner), expires_at: refreshed.expiresAt, updated_at: new Date().toISOString() })
        .eq("connection_id", (connection as { id: string }).id);
    }
    const busy = await fetchFreeBusy(accessToken, fromIso, toIso, AbortSignal.timeout(GOOGLE_BUSY_TIMEOUT_MS));
    return busy.map((b, i) => ({ id: `google:${i}:${b.start}`, start: new Date(b.start), end: new Date(b.end) }));
  } catch {
    return [];
  }
}
