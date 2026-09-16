// Server-only Google Calendar API OAuth2 + REST client — never import
// into a client component. Same "missing key degrades gracefully"
// pattern as lib/oura.ts / lib/google-health.ts.
//
// Implements google_calendar_federation_feasibility_sept16.md's
// architecture (a): create one dedicated "<Coach> — Work" Google
// Calendar per coach, mirror in-app work events (bookings) into it
// one-way, then share it back to the coach's own Google account at
// `freeBusyReader` ACL so their real personal calendar shows work as a
// native opaque busy block. Separately, read the coach's personal
// calendar's real event details one-way and cache them for rendering
// inside the in-app work Calendar.
//
// Single OAuth scope by design: `calendar.freebusy`,
// `calendar.events.readonly` and `calendar.acls` are each individually
// narrower, but `calendars.insert` (creating the dedicated work
// calendar) is only covered by the full `calendar` scope per Google's
// own API reference — there is no dedicated granular scope for
// creating a Calendar resource. Since the full scope already
// encompasses every narrower operation this feature needs (ACL sharing,
// event mirroring, reading the personal calendar), requesting several
// scopes alongside it would only add consent-screen noise without
// reducing what's granted. `userinfo.email` is requested alongside it
// so the connecting Google account's own address can be used as the
// freeBusyReader share target automatically, with no separate "which
// email is yours" input step.

const GOOGLE_AUTHORIZE_URL = "https://accounts.google.com/o/oauth2/v2/auth";
const GOOGLE_TOKEN_URL = "https://oauth2.googleapis.com/token";
const GOOGLE_USERINFO_URL = "https://www.googleapis.com/oauth2/v2/userinfo";
const GOOGLE_CALENDAR_API_BASE = "https://www.googleapis.com/calendar/v3";

const GOOGLE_CALENDAR_SCOPES = [
  "https://www.googleapis.com/auth/calendar",
  "https://www.googleapis.com/auth/userinfo.email",
].join(" ");

export function isGoogleCalendarConfigured(): boolean {
  return !!(
    process.env.GOOGLE_CALENDAR_CLIENT_ID &&
    process.env.GOOGLE_CALENDAR_CLIENT_SECRET &&
    process.env.GOOGLE_CALENDAR_REDIRECT_URI
  );
}

function requireGoogleCalendarEnv() {
  const clientId = process.env.GOOGLE_CALENDAR_CLIENT_ID;
  const clientSecret = process.env.GOOGLE_CALENDAR_CLIENT_SECRET;
  const redirectUri = process.env.GOOGLE_CALENDAR_REDIRECT_URI;
  if (!clientId || !clientSecret || !redirectUri) {
    throw new Error(
      "Google Calendar isn't configured — set GOOGLE_CALENDAR_CLIENT_ID, GOOGLE_CALENDAR_CLIENT_SECRET, GOOGLE_CALENDAR_REDIRECT_URI."
    );
  }
  return { clientId, clientSecret, redirectUri };
}

export function getGoogleCalendarAuthorizeUrl(state: string): string {
  const { clientId, redirectUri } = requireGoogleCalendarEnv();
  const params = new URLSearchParams({
    client_id: clientId,
    redirect_uri: redirectUri,
    response_type: "code",
    // offline + consent so a refresh_token is actually issued — Google
    // only returns one on the FIRST consent grant per user unless
    // prompt is forced, which would silently break reconnect-after-
    // revoke (same reasoning as lib/google-health.ts).
    access_type: "offline",
    prompt: "consent",
    scope: GOOGLE_CALENDAR_SCOPES,
    state,
  });
  return `${GOOGLE_AUTHORIZE_URL}?${params.toString()}`;
}

export interface GoogleCalendarTokens {
  accessToken: string;
  refreshToken: string;
  expiresAt: string; // ISO timestamp
}

function tokensFromResponse(
  data: { access_token: string; refresh_token?: string; expires_in: number },
  fallbackRefreshToken?: string
): GoogleCalendarTokens {
  const refreshToken = data.refresh_token ?? fallbackRefreshToken;
  if (!refreshToken) {
    throw new Error("Google Calendar didn't return a refresh token and none was already on file.");
  }
  return {
    accessToken: data.access_token,
    refreshToken,
    expiresAt: new Date(Date.now() + data.expires_in * 1000).toISOString(),
  };
}

export async function exchangeGoogleCalendarCode(code: string): Promise<GoogleCalendarTokens> {
  const { clientId, clientSecret, redirectUri } = requireGoogleCalendarEnv();
  const response = await fetch(GOOGLE_TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "authorization_code",
      code,
      client_id: clientId,
      client_secret: clientSecret,
      redirect_uri: redirectUri,
    }),
  });
  if (!response.ok) {
    throw new Error(`Google Calendar token exchange failed: ${await response.text()}`);
  }
  return tokensFromResponse(await response.json());
}

export async function refreshGoogleCalendarTokens(refreshToken: string): Promise<GoogleCalendarTokens> {
  const { clientId, clientSecret } = requireGoogleCalendarEnv();
  const response = await fetch(GOOGLE_TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "refresh_token",
      refresh_token: refreshToken,
      client_id: clientId,
      client_secret: clientSecret,
    }),
  });
  if (!response.ok) {
    throw new Error(`Google Calendar token refresh failed: ${await response.text()}`);
  }
  return tokensFromResponse(await response.json(), refreshToken);
}

export async function fetchGoogleAccountEmail(accessToken: string): Promise<string> {
  const response = await fetch(GOOGLE_USERINFO_URL, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (!response.ok) {
    throw new Error(`Google userinfo fetch failed: ${await response.text()}`);
  }
  const data = await response.json();
  if (typeof data.email !== "string") {
    throw new Error("Google userinfo response didn't include an email.");
  }
  return data.email;
}

// Creates the one dedicated "work" calendar this coach's in-app bookings
// mirror into. Real endpoint/body shape per Google's Calendars.insert
// reference (developers.google.com/workspace/calendar/api/v3/reference/
// calendars/insert) — a bare {summary} is a valid minimal body.
export async function createWorkCalendar(accessToken: string, coachName: string): Promise<string> {
  const response = await fetch(`${GOOGLE_CALENDAR_API_BASE}/calendars`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ summary: `${coachName} — Work` }),
  });
  if (!response.ok) {
    throw new Error(`Google Calendar creation failed: ${await response.text()}`);
  }
  const data = await response.json();
  return data.id as string;
}

// Shares the work calendar back to the coach's own personal Google
// account at the narrowest real sharing tier — freeBusyReader — so
// Google's own calendar UI/sync renders every event on it as an opaque
// busy block on the personal side, natively, with zero custom
// rendering. Calendar-level ACL, not per-event (Acl.insert reference:
// developers.google.com/workspace/calendar/api/v3/reference/acl/insert).
export async function shareCalendarFreeBusy(
  accessToken: string,
  calendarId: string,
  personalEmail: string
): Promise<void> {
  const response = await fetch(
    `${GOOGLE_CALENDAR_API_BASE}/calendars/${encodeURIComponent(calendarId)}/acl`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        role: "freeBusyReader",
        scope: { type: "user", value: personalEmail },
      }),
    }
  );
  if (!response.ok) {
    throw new Error(`Google Calendar ACL share failed: ${await response.text()}`);
  }
}

export interface MirrorEventInput {
  existingEventId: string | null;
  title: string;
  startAt: string; // ISO
  endAt: string; // ISO
}

// Idempotent create-or-update: PATCHes the same Google event on a
// reschedule instead of creating a duplicate, keyed off the event id
// this app already stored from the original mirror (bookings.
// google_calendar_event_id). Real Events.insert/patch body shape per
// developers.google.com/workspace/calendar/api/v3/reference/events.
export async function upsertWorkCalendarEvent(
  accessToken: string,
  calendarId: string,
  input: MirrorEventInput
): Promise<string> {
  const body = JSON.stringify({
    summary: input.title,
    start: { dateTime: input.startAt },
    end: { dateTime: input.endAt },
  });
  const base = `${GOOGLE_CALENDAR_API_BASE}/calendars/${encodeURIComponent(calendarId)}/events`;
  const url = input.existingEventId ? `${base}/${input.existingEventId}` : base;
  const method = input.existingEventId ? "PATCH" : "POST";

  const response = await fetch(url, {
    method,
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json",
    },
    body,
  });
  if (!response.ok) {
    throw new Error(`Google Calendar event ${method === "PATCH" ? "update" : "create"} failed: ${await response.text()}`);
  }
  const data = await response.json();
  return data.id as string;
}

// Mirrors the self-cleaning pattern lib/send-push.ts already uses for
// dead push subscriptions: a 404/410 here means the event (or the
// calendar itself) is already gone on Google's side, which is the
// desired end state for a delete — not a real failure to surface.
export async function deleteWorkCalendarEvent(
  accessToken: string,
  calendarId: string,
  eventId: string
): Promise<void> {
  const response = await fetch(
    `${GOOGLE_CALENDAR_API_BASE}/calendars/${encodeURIComponent(calendarId)}/events/${eventId}`,
    {
      method: "DELETE",
      headers: { Authorization: `Bearer ${accessToken}` },
    }
  );
  if (!response.ok && response.status !== 404 && response.status !== 410) {
    throw new Error(`Google Calendar event delete failed: ${await response.text()}`);
  }
}

export interface PersonalCalendarEvent {
  externalEventId: string;
  title: string;
  startAt: string; // ISO
  endAt: string; // ISO
}

// Pure, exported for direct testing (no fetch involved). Filters out
// all-day entries (date-only start/end, no dateTime — an all-day event
// isn't a specific busy window the in-app work Calendar can usefully
// render alongside timed bookings) and cancelled entries (Google keeps
// a tombstone item with status "cancelled" in the list response rather
// than omitting it, real behavior confirmed against Events.list's own
// reference doc).
export function mapPersonalEventsResponse(
  items: Array<Record<string, unknown>> | undefined
): PersonalCalendarEvent[] {
  if (!Array.isArray(items)) return [];
  const events: PersonalCalendarEvent[] = [];
  for (const item of items) {
    if (item.status === "cancelled") continue;
    const id = item.id;
    const summary = item.summary;
    const start = item.start as Record<string, unknown> | undefined;
    const end = item.end as Record<string, unknown> | undefined;
    const startAt = start?.dateTime;
    const endAt = end?.dateTime;
    if (
      typeof id === "string" &&
      typeof startAt === "string" &&
      typeof endAt === "string"
    ) {
      events.push({
        externalEventId: id,
        title: typeof summary === "string" && summary.length > 0 ? summary : "Busy",
        startAt,
        endAt,
      });
    }
  }
  return events;
}

// Real endpoint/params per Events.list reference
// (developers.google.com/workspace/calendar/api/v3/reference/events/
// list) — singleEvents expands recurring events into individual
// instances (needed to get concrete start/end times per occurrence
// rather than one recurrence rule this app has no use for).
export async function listPersonalCalendarEvents(
  accessToken: string,
  timeMinIso: string,
  timeMaxIso: string
): Promise<PersonalCalendarEvent[]> {
  const params = new URLSearchParams({
    timeMin: timeMinIso,
    timeMax: timeMaxIso,
    singleEvents: "true",
    orderBy: "startTime",
  });
  const response = await fetch(
    `${GOOGLE_CALENDAR_API_BASE}/calendars/primary/events?${params.toString()}`,
    { headers: { Authorization: `Bearer ${accessToken}` } }
  );
  if (!response.ok) {
    throw new Error(`Google Calendar personal events fetch failed: ${await response.text()}`);
  }
  const data = await response.json();
  return mapPersonalEventsResponse(data.items);
}
