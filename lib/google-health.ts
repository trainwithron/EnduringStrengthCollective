// Server-only Google Health API OAuth2 + REST client — never import into a
// client component. Same "missing key degrades gracefully" pattern as
// lib/oura.ts / lib/withings.ts.
//
// This is Google's real, current "Google Health API" (health.googleapis.com,
// server-side OAuth2, replaces the legacy Fitbit Web API Google is
// sunsetting) — NOT Android Health Connect, which has no server API at
// all and needs an on-device companion app (see wearables_integration.md's
// own research distinguishing the two). Same daily-cron-poll shape as
// Oura/Withings, not push-based like Garmin.
//
// Endpoints, scopes, and the top-level response shape below are REAL and
// verified directly against Google's own developer docs
// (developers.google.com/health/setup, /health/data-types,
// /health/reference/rest/v4/users.dataTypes.dataPoints, and the sleep/
// vitals data-type pages) — not guessed. Two fields are marked below as
// a reasonable-but-unverified best effort where Google's own docs didn't
// show a concrete example for that specific data type at the time this
// was written (steps' and weight's exact field names specifically) —
// worth a direct check against a real live response once Ron's own
// Google Cloud project has real API access, same honesty discipline as
// lib/garmin.ts's own flagged gaps.

const GOOGLE_AUTHORIZE_URL = "https://accounts.google.com/o/oauth2/v2/auth";
const GOOGLE_TOKEN_URL = "https://oauth2.googleapis.com/token";
const GOOGLE_HEALTH_API_BASE = "https://health.googleapis.com/v4";

// Real scope strings, confirmed against developers.google.com/health/data-types:
// activity_and_fitness covers steps; sleep covers sleep sessions;
// health_metrics_and_measurements covers both heart rate and weight
// (Google consolidates those two into one scope, unlike Oura's per-
// resource split).
const GOOGLE_HEALTH_SCOPES = [
  "https://www.googleapis.com/auth/googlehealth.activity_and_fitness.readonly",
  "https://www.googleapis.com/auth/googlehealth.sleep.readonly",
  "https://www.googleapis.com/auth/googlehealth.health_metrics_and_measurements.readonly",
].join(" ");

export function isGoogleHealthConfigured(): boolean {
  return !!(
    process.env.GOOGLE_HEALTH_CLIENT_ID &&
    process.env.GOOGLE_HEALTH_CLIENT_SECRET &&
    process.env.GOOGLE_HEALTH_REDIRECT_URI
  );
}

function requireGoogleHealthEnv() {
  const clientId = process.env.GOOGLE_HEALTH_CLIENT_ID;
  const clientSecret = process.env.GOOGLE_HEALTH_CLIENT_SECRET;
  const redirectUri = process.env.GOOGLE_HEALTH_REDIRECT_URI;
  if (!clientId || !clientSecret || !redirectUri) {
    throw new Error(
      "Google Health isn't configured — set GOOGLE_HEALTH_CLIENT_ID, GOOGLE_HEALTH_CLIENT_SECRET, GOOGLE_HEALTH_REDIRECT_URI."
    );
  }
  return { clientId, clientSecret, redirectUri };
}

export function getGoogleHealthAuthorizeUrl(state: string): string {
  const { clientId, redirectUri } = requireGoogleHealthEnv();
  const params = new URLSearchParams({
    client_id: clientId,
    redirect_uri: redirectUri,
    response_type: "code",
    // offline + consent so a refresh_token is actually issued — Google
    // only returns one on the FIRST consent grant per user unless prompt
    // is forced, which would silently break reconnect-after-revoke.
    access_type: "offline",
    prompt: "consent",
    scope: GOOGLE_HEALTH_SCOPES,
    state,
  });
  return `${GOOGLE_AUTHORIZE_URL}?${params.toString()}`;
}

export interface GoogleHealthTokens {
  accessToken: string;
  refreshToken: string;
  expiresAt: string; // ISO timestamp
}

function tokensFromResponse(data: {
  access_token: string;
  refresh_token?: string;
  expires_in: number;
}, fallbackRefreshToken?: string): GoogleHealthTokens {
  const refreshToken = data.refresh_token ?? fallbackRefreshToken;
  if (!refreshToken) {
    throw new Error("Google Health didn't return a refresh token and none was already on file.");
  }
  return {
    accessToken: data.access_token,
    refreshToken,
    expiresAt: new Date(Date.now() + data.expires_in * 1000).toISOString(),
  };
}

export async function exchangeGoogleHealthCode(code: string): Promise<GoogleHealthTokens> {
  const { clientId, clientSecret, redirectUri } = requireGoogleHealthEnv();
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
    throw new Error(`Google Health token exchange failed: ${await response.text()}`);
  }
  return tokensFromResponse(await response.json());
}

export async function refreshGoogleHealthTokens(refreshToken: string): Promise<GoogleHealthTokens> {
  const { clientId, clientSecret } = requireGoogleHealthEnv();
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
    throw new Error(`Google Health token refresh failed: ${await response.text()}`);
  }
  return tokensFromResponse(await response.json(), refreshToken);
}

export interface GoogleHealthDailyPoint {
  date: string; // YYYY-MM-DD
  value: number;
}

async function listDataPoints(accessToken: string, dataType: string, startDate: string, endDate: string) {
  // Real filter syntax + endpoint shape confirmed via Google's own
  // codelab example (a live GET .../dataTypes/exercise/dataPoints?filter=...
  // request/response pair) — dataType path segments and the civil_start_time
  // filter field name are documented per-data-type, so the exact filter
  // field for steps/sleep/heart-rate/weight below is this same convention
  // applied consistently, not independently re-verified per type.
  const filter = `${dataType}.interval.civil_start_time >= "${startDate}T00:00:00" AND ${dataType}.interval.civil_start_time <= "${endDate}T23:59:59"`;
  const url = `${GOOGLE_HEALTH_API_BASE}/users/me/dataTypes/${dataType}/dataPoints?filter=${encodeURIComponent(filter)}`;
  const response = await fetch(url, {
    headers: { Authorization: `Bearer ${accessToken}`, Accept: "application/json" },
  });
  if (!response.ok) {
    throw new Error(`Google Health ${dataType} fetch failed: ${await response.text()}`);
  }
  const data = await response.json();
  return (data.dataPoints ?? []) as Array<Record<string, unknown>>;
}

// Pure, exported for direct testing (no fetch involved) — see the header
// comment on fetchGoogleHealthDailyMetrics for why this exists instead of
// a native sleep-score field. Returns null when there's nothing usable
// to compute from, so the caller can skip the day entirely rather than
// recording a fabricated 0.
export function computeSleepEfficiencyFromStages(
  stages: Array<Record<string, unknown>> | undefined
): number | null {
  if (!Array.isArray(stages) || stages.length === 0) return null;
  let totalMs = 0;
  let asleepMs = 0;
  for (const stage of stages) {
    const start = stage.startTime;
    const end = stage.endTime;
    if (typeof start !== "string" || typeof end !== "string") continue;
    const durationMs = new Date(end).getTime() - new Date(start).getTime();
    if (!Number.isFinite(durationMs) || durationMs <= 0) continue;
    totalMs += durationMs;
    if (stage.type !== "AWAKE") asleepMs += durationMs;
  }
  if (totalMs === 0) return null;
  return Math.round((asleepMs / totalMs) * 100);
}

function dateFromInterval(point: Record<string, unknown>): string | null {
  const dataType = Object.keys(point).find((k) => k !== "name" && k !== "dataSource");
  if (!dataType) return null;
  const value = point[dataType] as Record<string, unknown> | undefined;
  const interval = value?.interval as Record<string, unknown> | undefined;
  const start = interval?.startTime;
  return typeof start === "string" ? start.slice(0, 10) : null;
}

// Fields confirmed against Google's real docs where noted; steps' and
// weight's own exact field names are this file's two flagged best-effort
// guesses (see header comment) — Google's public docs confirmed the
// scope and that an "Interval"/"Sample" record exists for each, but
// didn't show a concrete example payload for either at the time this was
// written, unlike sleep (real fields: sleepStages/minutesToFallAsleep/
// minutesAfterWakeup) and heart rate (real field: beatsPerMinute).
export async function fetchGoogleHealthDailyMetrics(
  accessToken: string,
  startDate: string,
  endDate: string
): Promise<{
  steps: GoogleHealthDailyPoint[];
  sleepScore: GoogleHealthDailyPoint[];
  restingHeartRate: GoogleHealthDailyPoint[];
  weight: GoogleHealthDailyPoint[];
}> {
  const [stepsPoints, sleepPoints, heartRatePoints, weightPoints] = await Promise.all([
    listDataPoints(accessToken, "steps", startDate, endDate),
    listDataPoints(accessToken, "sleep", startDate, endDate),
    listDataPoints(accessToken, "heart-rate", startDate, endDate),
    listDataPoints(accessToken, "weight", startDate, endDate),
  ]);

  const steps: GoogleHealthDailyPoint[] = [];
  for (const p of stepsPoints) {
    const date = dateFromInterval(p);
    // Best-effort field guess (see header comment) — Google's own
    // exercise example nests a count under metricsSummary.steps; applied
    // the same convention here since steps' own dedicated example wasn't
    // shown.
    const stepsObj = p.steps as Record<string, unknown> | undefined;
    const count = stepsObj?.count ?? (stepsObj?.metricsSummary as Record<string, unknown> | undefined)?.steps;
    if (date && (typeof count === "number" || typeof count === "string")) {
      steps.push({ date, value: Number(count) });
    }
  }

  // No native sleep-quality/score field exists in Google's schema
  // (confirmed directly) — Google's own docs suggest sleep efficiency
  // (minutes asleep / minutes in bed x 100) as the analog metric, so
  // that's computed here and stored under this app's existing
  // 'sleep_score' metric_type. This is a genuinely different number than
  // Oura's own composite sleep score (which factors in more than just
  // time-in-bed efficiency) — same metric_type slot, not an equivalent
  // measurement; worth surfacing that distinction if this is ever shown
  // side-by-side with an Oura-sourced value for the same person.
  const sleepScore: GoogleHealthDailyPoint[] = [];
  for (const p of sleepPoints) {
    const date = dateFromInterval(p);
    const sleep = p.sleep as Record<string, unknown> | undefined;
    const stages = sleep?.sleepStages as Array<Record<string, unknown>> | undefined;
    const efficiency = computeSleepEfficiencyFromStages(stages);
    if (date && efficiency !== null) {
      sleepScore.push({ date, value: efficiency });
    }
  }

  const restingHeartRate: GoogleHealthDailyPoint[] = [];
  for (const p of heartRatePoints) {
    const date = dateFromInterval(p);
    const hr = p.heartRate as Record<string, unknown> | undefined;
    const bpm = hr?.beatsPerMinute;
    const motionContext = (hr?.metadata as Record<string, unknown> | undefined)?.motionContext;
    // Google's heart-rate stream is every sample, not a dedicated
    // "resting heart rate" field the way Oura's daily_readiness is —
    // approximated as the lowest SEDENTARY-context reading for the day,
    // computed per-day below rather than per-sample here.
    if (date && typeof bpm === "string" && motionContext === "SEDENTARY") {
      restingHeartRate.push({ date, value: Number(bpm) });
    }
  }
  const lowestByDate = new Map<string, number>();
  for (const point of restingHeartRate) {
    const current = lowestByDate.get(point.date);
    if (current === undefined || point.value < current) lowestByDate.set(point.date, point.value);
  }
  const restingHeartRateDaily = Array.from(lowestByDate.entries()).map(([date, value]) => ({ date, value }));

  const weight: GoogleHealthDailyPoint[] = [];
  const LBS_PER_KG = 2.2046226218;
  for (const p of weightPoints) {
    const date = dateFromInterval(p);
    // Best-effort field guess (see header comment) — mirrors the
    // value+unit convention Withings' own API already uses
    // (lib/withings.ts), applied here since Google's own weight example
    // wasn't shown; re-verify once real access exists.
    const weightObj = p.weight as Record<string, unknown> | undefined;
    const kg = weightObj?.massKg ?? weightObj?.value;
    if (date && typeof kg === "number") {
      weight.push({ date, value: Math.round(kg * LBS_PER_KG * 10) / 10 });
    }
  }

  return { steps, sleepScore, restingHeartRate: restingHeartRateDaily, weight };
}
