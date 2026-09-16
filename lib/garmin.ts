// Server-only Garmin Health API OAuth2 (PKCE) client — never import into a
// client component. Same "missing key degrades gracefully" pattern as
// lib/oura.ts / lib/withings.ts.
//
// Real, important architectural difference from Oura/Withings, per
// wearables_integration.md's own research and Garmin's public developer
// site (developer.garmin.com/gc-developer-program/health-api/): Garmin's
// Health API is push-based, not polled. Once a user connects, Garmin
// pushes daily/sleep/pulse-ox/etc. summaries to a webhook URL registered
// with Garmin at partner-approval time — there is no equivalent of
// lib/oura.ts's fetchOuraDailyMetrics() to poll on a cron. See
// app/api/garmin/webhook/route.ts for the receiving side.
//
// OAuth2 endpoints below are REAL and verified directly against Garmin's
// own official "OAuth2.0 PKCE Specification" PDF
// (developerportal.garmin.com/sites/default/files/OAuth2PKCE_1.pdf) — not
// guessed. What is NOT publicly documented (confirmed by checking
// Garmin's own developer site directly): the exact OAuth scope string(s)
// to request, the webhook payload's exact field names, and how a webhook
// payload's signature/authenticity should be verified. All three are
// gated behind Garmin's partner-program approval (the real, ~2-business-
// day application only Ron can submit — see this feature's own build
// report). Marked clearly below wherever this file has to make a
// best-effort choice instead of citing a verified source.

import { createHash, randomBytes } from "crypto";

const GARMIN_AUTHORIZE_URL = "https://connect.garmin.com/oauth2Confirm";
const GARMIN_TOKEN_URL = "https://diauth.garmin.com/di-oauth2-service/oauth/token";

export function isGarminConfigured(): boolean {
  return !!(
    process.env.GARMIN_CLIENT_ID &&
    process.env.GARMIN_CLIENT_SECRET &&
    process.env.GARMIN_REDIRECT_URI
  );
}

function requireGarminEnv() {
  const clientId = process.env.GARMIN_CLIENT_ID;
  const clientSecret = process.env.GARMIN_CLIENT_SECRET;
  const redirectUri = process.env.GARMIN_REDIRECT_URI;
  if (!clientId || !clientSecret || !redirectUri) {
    throw new Error(
      "Garmin isn't configured — set GARMIN_CLIENT_ID, GARMIN_CLIENT_SECRET, GARMIN_REDIRECT_URI."
    );
  }
  return { clientId, clientSecret, redirectUri };
}

function base64UrlEncode(buf: Buffer): string {
  return buf.toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

export interface GarminPkcePair {
  codeVerifier: string;
  codeChallenge: string;
}

// PKCE (RFC 7636, S256) — required by Garmin's own OAuth2 spec, unlike
// Oura/Withings' plain authorization-code flow. The verifier must be
// persisted (in the same short-lived httpOnly cookie already used for
// the CSRF state value) so the callback route can present it at token-
// exchange time.
export function generateGarminPkcePair(): GarminPkcePair {
  const codeVerifier = base64UrlEncode(randomBytes(32));
  const codeChallenge = base64UrlEncode(createHash("sha256").update(codeVerifier).digest());
  return { codeVerifier, codeChallenge };
}

export function getGarminAuthorizeUrl(state: string, codeChallenge: string): string {
  const { clientId, redirectUri } = requireGarminEnv();
  // "Requested permissions (e.g., wellness data access)" per Garmin's own
  // PKCE spec — the exact scope string Garmin expects isn't published on
  // their public site (confirmed directly); this is the most literal
  // reading of what that spec document itself shows, worth a direct
  // check against the real partner API reference once access is granted.
  const params = new URLSearchParams({
    client_id: clientId,
    redirect_uri: redirectUri,
    response_type: "code",
    scope: "wellness",
    code_challenge: codeChallenge,
    code_challenge_method: "S256",
    state,
  });
  return `${GARMIN_AUTHORIZE_URL}?${params.toString()}`;
}

export interface GarminTokens {
  accessToken: string;
  refreshToken: string;
  expiresAt: string; // ISO timestamp
}

function tokensFromResponse(data: {
  access_token: string;
  refresh_token: string;
  expires_in: number;
}): GarminTokens {
  return {
    accessToken: data.access_token,
    refreshToken: data.refresh_token,
    expiresAt: new Date(Date.now() + data.expires_in * 1000).toISOString(),
  };
}

export async function exchangeGarminCode(code: string, codeVerifier: string): Promise<GarminTokens> {
  const { clientId, redirectUri } = requireGarminEnv();
  const response = await fetch(GARMIN_TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "authorization_code",
      code,
      client_id: clientId,
      redirect_uri: redirectUri,
      code_verifier: codeVerifier,
    }),
  });
  if (!response.ok) {
    throw new Error(`Garmin token exchange failed: ${await response.text()}`);
  }
  return tokensFromResponse(await response.json());
}

export async function refreshGarminTokens(refreshToken: string): Promise<GarminTokens> {
  const { clientId, clientSecret } = requireGarminEnv();
  const response = await fetch(GARMIN_TOKEN_URL, {
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
    throw new Error(`Garmin token refresh failed: ${await response.text()}`);
  }
  const data = await response.json();
  return tokensFromResponse({ ...data, refresh_token: data.refresh_token ?? refreshToken });
}

export interface GarminMetricRow {
  externalUserId: string; // Garmin's own user id from the webhook payload — resolved to a profile_id by the webhook route via wearable_connections.external_user_id
  date: string; // YYYY-MM-DD
  metricType: "steps" | "sleep_score" | "hrv_balance" | "resting_heart_rate";
  value: number;
}

// Best-effort parse of a Garmin webhook push body into this app's own
// metric shape. NOT verified against Garmin's real payload schema —
// their public developer site does not publish it (confirmed directly;
// it's gated behind partner-program approval). Structured defensively
// (every field access is optional-chained, unknown shapes are silently
// skipped rather than throwing) specifically so an approval-gated,
// unverified guess can't crash the webhook endpoint or lose the rest of
// a batch over one malformed entry. Field-name guesses below are informed
// by Garmin's own documented data categories (steps, sleep, pulse-ox/
// heart-rate — developer.garmin.com/gc-developer-program/health-api/)
// combined with the shape third-party wearable-data aggregators with
// real Garmin partner access publicly describe (e.g. Rook's docs use
// steps_int/sleep_efficiency_1_100_score_int-style flat keys) — a
// reasonable starting guess, not a verified source. **Re-verify this
// function's field names against Garmin's real partner API reference the
// moment that access exists**, before trusting synced data at face value.
export function parseGarminWebhookPayload(body: unknown): GarminMetricRow[] {
  const rows: GarminMetricRow[] = [];
  if (!body || typeof body !== "object") return rows;

  // Garmin's push architecture batches multiple users' summaries into one
  // request under type-named arrays (e.g. "dailies": [...], "sleeps": [...])
  // per their own webhook overview — handle both that shape and a single
  // flat object defensively, since the exact envelope isn't verified.
  const asRecord = body as Record<string, unknown>;
  const dailies = Array.isArray(asRecord.dailies) ? asRecord.dailies : [asRecord];
  const sleeps = Array.isArray(asRecord.sleeps) ? asRecord.sleeps : [];

  function dateFromEpoch(startTimeInSeconds: unknown, offsetSeconds: unknown): string | null {
    if (typeof startTimeInSeconds !== "number") return null;
    const offset = typeof offsetSeconds === "number" ? offsetSeconds : 0;
    return new Date((startTimeInSeconds + offset) * 1000).toISOString().slice(0, 10);
  }

  for (const entry of dailies) {
    if (!entry || typeof entry !== "object") continue;
    const e = entry as Record<string, unknown>;
    const userId = typeof e.userId === "string" ? e.userId : typeof e.userAccessToken === "string" ? e.userAccessToken : null;
    const date = dateFromEpoch(e.startTimeInSeconds, e.startTimeOffsetInSeconds ?? e.durationInSeconds);
    if (!userId || !date) continue;
    if (typeof e.steps === "number") {
      rows.push({ externalUserId: userId, date, metricType: "steps", value: e.steps });
    }
    if (typeof e.restingHeartRateInBeatsPerMinute === "number") {
      rows.push({
        externalUserId: userId,
        date,
        metricType: "resting_heart_rate",
        value: e.restingHeartRateInBeatsPerMinute,
      });
    }
  }

  for (const entry of sleeps) {
    if (!entry || typeof entry !== "object") continue;
    const e = entry as Record<string, unknown>;
    const userId = typeof e.userId === "string" ? e.userId : typeof e.userAccessToken === "string" ? e.userAccessToken : null;
    const date = dateFromEpoch(e.calendarDate ? null : e.startTimeInSeconds, e.startTimeOffsetInSeconds);
    const dateKey = typeof e.calendarDate === "string" ? e.calendarDate : date;
    if (!userId || !dateKey) continue;
    // Garmin's own "overallSleepScore.value" (newer API versions) is the
    // closest analog to Oura's daily_sleep.score — used here, but this is
    // the single least-confirmed field name in this whole file.
    const overall = e.overallSleepScore as Record<string, unknown> | undefined;
    if (overall && typeof overall.value === "number") {
      rows.push({ externalUserId: userId, date: dateKey, metricType: "sleep_score", value: overall.value });
    }
  }

  return rows;
}
