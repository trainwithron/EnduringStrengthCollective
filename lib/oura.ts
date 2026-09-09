// Server-only Oura OAuth2 + Cloud API client — never import into a client
// component. Same "missing key degrades gracefully" pattern as
// lib/stripe.ts: the connect/callback/sync routes all check
// isOuraConfigured() first and return a clear "not configured" message
// instead of crashing when the three env vars aren't set.

const OURA_AUTHORIZE_URL = "https://cloud.ouraring.com/oauth/authorize";
const OURA_TOKEN_URL = "https://api.ouraring.com/oauth/token";
const OURA_API_BASE = "https://api.ouraring.com/v2/usercollection";

export function isOuraConfigured(): boolean {
  return !!(
    process.env.OURA_CLIENT_ID &&
    process.env.OURA_CLIENT_SECRET &&
    process.env.OURA_REDIRECT_URI
  );
}

function requireOuraEnv() {
  const clientId = process.env.OURA_CLIENT_ID;
  const clientSecret = process.env.OURA_CLIENT_SECRET;
  const redirectUri = process.env.OURA_REDIRECT_URI;
  if (!clientId || !clientSecret || !redirectUri) {
    throw new Error(
      "Oura isn't configured — set OURA_CLIENT_ID, OURA_CLIENT_SECRET, OURA_REDIRECT_URI."
    );
  }
  return { clientId, clientSecret, redirectUri };
}

export function getOuraAuthorizeUrl(state: string): string {
  const { clientId, redirectUri } = requireOuraEnv();
  const params = new URLSearchParams({
    response_type: "code",
    client_id: clientId,
    redirect_uri: redirectUri,
    scope: "daily",
    state,
  });
  return `${OURA_AUTHORIZE_URL}?${params.toString()}`;
}

export interface OuraTokens {
  accessToken: string;
  refreshToken: string;
  expiresAt: string; // ISO timestamp
}

function tokensFromResponse(data: {
  access_token: string;
  refresh_token: string;
  expires_in: number;
}): OuraTokens {
  return {
    accessToken: data.access_token,
    refreshToken: data.refresh_token,
    expiresAt: new Date(Date.now() + data.expires_in * 1000).toISOString(),
  };
}

export async function exchangeOuraCode(code: string): Promise<OuraTokens> {
  const { clientId, clientSecret, redirectUri } = requireOuraEnv();
  const response = await fetch(OURA_TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "authorization_code",
      code,
      redirect_uri: redirectUri,
      client_id: clientId,
      client_secret: clientSecret,
    }),
  });
  if (!response.ok) {
    throw new Error(`Oura token exchange failed: ${await response.text()}`);
  }
  return tokensFromResponse(await response.json());
}

export async function refreshOuraTokens(refreshToken: string): Promise<OuraTokens> {
  const { clientId, clientSecret } = requireOuraEnv();
  const response = await fetch(OURA_TOKEN_URL, {
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
    throw new Error(`Oura token refresh failed: ${await response.text()}`);
  }
  const data = await response.json();
  // Oura may or may not rotate the refresh token on each use — fall back
  // to the existing one if the response doesn't include a new one.
  return tokensFromResponse({ ...data, refresh_token: data.refresh_token ?? refreshToken });
}

export interface OuraDailyPoint {
  date: string; // YYYY-MM-DD, from Oura's "day" field
  value: number;
}

// Only the two fields confirmed against Oura's real v2 schema —
// daily_activity.steps and daily_sleep.score. Total sleep duration in
// minutes lives on the separate session-level "sleep" resource, not
// daily_sleep; add it as its own fetch once that endpoint's exact shape
// is verified, rather than guessing field names here.
export async function fetchOuraDailyMetrics(
  accessToken: string,
  startDate: string,
  endDate: string
): Promise<{ steps: OuraDailyPoint[]; sleepScore: OuraDailyPoint[] }> {
  const params = new URLSearchParams({ start_date: startDate, end_date: endDate });

  async function getCollection(path: "daily_activity" | "daily_sleep") {
    const response = await fetch(`${OURA_API_BASE}/${path}?${params.toString()}`, {
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    if (!response.ok) {
      throw new Error(`Oura ${path} fetch failed: ${await response.text()}`);
    }
    const { data } = await response.json();
    return data as Array<Record<string, unknown>>;
  }

  const [activity, sleep] = await Promise.all([
    getCollection("daily_activity"),
    getCollection("daily_sleep"),
  ]);

  return {
    steps: activity
      .filter((d) => typeof d.day === "string" && typeof d.steps === "number")
      .map((d) => ({ date: d.day as string, value: d.steps as number })),
    sleepScore: sleep
      .filter((d) => typeof d.day === "string" && typeof d.score === "number")
      .map((d) => ({ date: d.day as string, value: d.score as number })),
  };
}
