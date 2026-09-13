// Server-only Withings OAuth2 + API client — never import into a client
// component. Same "missing key degrades gracefully" pattern as
// lib/oura.ts: the connect/callback/sync routes all check
// isWithingsConfigured() first and return a clear "not configured"
// message instead of crashing when the three env vars aren't set.
//
// Withings' real API shape differs from Oura's in a couple of ways worth
// noting since they're easy to get wrong: the token endpoint is a single
// POST to /v2/oauth2 with an `action` field (not a dedicated /token
// route), and a measurement's value is only meaningful combined with its
// own `unit` exponent — Withings reports weight as `value * 10^unit`
// grams... actually kilograms once that math is applied, per their
// documented Measure API.

const WITHINGS_AUTHORIZE_URL = "https://account.withings.com/oauth2_user/authorize2";
const WITHINGS_OAUTH2_URL = "https://wbsapi.withings.net/v2/oauth2";
const WITHINGS_MEASURE_URL = "https://wbsapi.withings.net/measure";

// Withings' own type code for a body-weight measurement in its Measure
// API's flat measure-type enum.
const WEIGHT_MEASURE_TYPE = 1;
const KG_TO_LBS = 2.2046226218;

export function isWithingsConfigured(): boolean {
  return !!(
    process.env.WITHINGS_CLIENT_ID &&
    process.env.WITHINGS_CLIENT_SECRET &&
    process.env.WITHINGS_REDIRECT_URI
  );
}

function requireWithingsEnv() {
  const clientId = process.env.WITHINGS_CLIENT_ID;
  const clientSecret = process.env.WITHINGS_CLIENT_SECRET;
  const redirectUri = process.env.WITHINGS_REDIRECT_URI;
  if (!clientId || !clientSecret || !redirectUri) {
    throw new Error(
      "Withings isn't configured — set WITHINGS_CLIENT_ID, WITHINGS_CLIENT_SECRET, WITHINGS_REDIRECT_URI."
    );
  }
  return { clientId, clientSecret, redirectUri };
}

export function getWithingsAuthorizeUrl(state: string): string {
  const { clientId, redirectUri } = requireWithingsEnv();
  const params = new URLSearchParams({
    response_type: "code",
    client_id: clientId,
    redirect_uri: redirectUri,
    scope: "user.metrics",
    state,
  });
  return `${WITHINGS_AUTHORIZE_URL}?${params.toString()}`;
}

export interface WithingsTokens {
  accessToken: string;
  refreshToken: string;
  expiresAt: string; // ISO timestamp
}

function tokensFromBody(body: {
  access_token: string;
  refresh_token: string;
  expires_in: number;
}): WithingsTokens {
  return {
    accessToken: body.access_token,
    refreshToken: body.refresh_token,
    expiresAt: new Date(Date.now() + body.expires_in * 1000).toISOString(),
  };
}

// Withings wraps every response (success or failure) in a `status`/`body`
// envelope with HTTP 200 either way — a non-zero `status` is the real
// error signal, not the HTTP status code.
async function postWithingsOAuth2(params: Record<string, string>) {
  const response = await fetch(WITHINGS_OAUTH2_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams(params),
  });
  const data = await response.json();
  if (!response.ok || data.status !== 0) {
    throw new Error(`Withings oauth2 request failed: ${JSON.stringify(data)}`);
  }
  return data.body;
}

export async function exchangeWithingsCode(code: string): Promise<WithingsTokens> {
  const { clientId, clientSecret, redirectUri } = requireWithingsEnv();
  const body = await postWithingsOAuth2({
    action: "requesttoken",
    grant_type: "authorization_code",
    client_id: clientId,
    client_secret: clientSecret,
    code,
    redirect_uri: redirectUri,
  });
  return tokensFromBody(body);
}

export async function refreshWithingsTokens(refreshToken: string): Promise<WithingsTokens> {
  const { clientId, clientSecret } = requireWithingsEnv();
  const body = await postWithingsOAuth2({
    action: "requesttoken",
    grant_type: "refresh_token",
    client_id: clientId,
    client_secret: clientSecret,
    refresh_token: refreshToken,
  });
  return tokensFromBody({ ...body, refresh_token: body.refresh_token ?? refreshToken });
}

export interface WithingsDailyPoint {
  date: string; // YYYY-MM-DD
  value: number; // lbs
}

// Withings' Measure API returns one "measure group" per recorded weigh-in
// (there can be several a day), each holding one or more typed measures.
// Only type WEIGHT_MEASURE_TYPE (1) is read here — body fat/muscle mass/
// etc. are real fields this API also returns, but weight is the one
// figure this app actually displays anywhere (see body_weight_logs).
// Multiple same-day readings are averaged into one point, matching how
// this app's own manual weight log is one-row-per-day.
export async function fetchWithingsWeight(
  accessToken: string,
  startDate: string,
  endDate: string
): Promise<WithingsDailyPoint[]> {
  const startTs = Math.floor(new Date(`${startDate}T00:00:00Z`).getTime() / 1000);
  const endTs = Math.floor(new Date(`${endDate}T23:59:59Z`).getTime() / 1000);

  const response = await fetch(WITHINGS_MEASURE_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      Authorization: `Bearer ${accessToken}`,
    },
    body: new URLSearchParams({
      action: "getmeas",
      meastype: String(WEIGHT_MEASURE_TYPE),
      category: "1", // real measurements only, not user-declared goals
      startdate: String(startTs),
      enddate: String(endTs),
    }),
  });
  const data = await response.json();
  if (!response.ok || data.status !== 0) {
    throw new Error(`Withings measure fetch failed: ${JSON.stringify(data)}`);
  }

  const sumByDate = new Map<string, { total: number; count: number }>();
  for (const group of data.body?.measuregrps ?? []) {
    const dateKey = new Date(group.date * 1000).toISOString().slice(0, 10);
    for (const measure of group.measures ?? []) {
      if (measure.type !== WEIGHT_MEASURE_TYPE) continue;
      const kg = measure.value * Math.pow(10, measure.unit);
      const lbs = kg * KG_TO_LBS;
      const entry = sumByDate.get(dateKey) ?? { total: 0, count: 0 };
      entry.total += lbs;
      entry.count += 1;
      sumByDate.set(dateKey, entry);
    }
  }

  return Array.from(sumByDate.entries()).map(([date, { total, count }]) => ({
    date,
    value: Math.round((total / count) * 10) / 10,
  }));
}
