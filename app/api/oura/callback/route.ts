import { NextResponse, after } from "next/server";
import { cookies } from "next/headers";
import { createServerClient } from "@/lib/supabase/server";
import { createServiceRoleClient } from "@/lib/supabase/service-role";
import { exchangeOuraCode, fetchOuraDailyMetrics } from "@/lib/oura";

// How far back a brand-new connection backfills. Oura's API will serve
// further back than this, but 90 days is enough real history to give
// the burnout/ACWR math and the Programming Spotter genuine signal
// immediately, without the backfill itself becoming a slow, rate-limit-
// risking fetch on every new connection.
const BACKFILL_WINDOW_DAYS = 90;

function daysAgoIso(days: number) {
  const d = new Date();
  d.setDate(d.getDate() - days);
  return d.toISOString().slice(0, 10);
}

// One-time historical pull for a brand-new connection — without this, a
// coach or athlete connecting a ring with a year of real history was
// treated identically to someone who bought it yesterday, since the
// daily cron sync (app/api/oura/sync/route.ts) only ever looks at the
// trailing week. Scheduled via next/server's after() so it runs to
// completion on Vercel without delaying the redirect back to Settings —
// a bare un-awaited promise isn't reliable here, since the serverless
// function can be frozen the moment the response is sent.
async function backfillHistory(connectionId: string, accessToken: string) {
  const serviceRole = createServiceRoleClient();
  const startDate = daysAgoIso(BACKFILL_WINDOW_DAYS);
  const endDate = new Date().toISOString().slice(0, 10);

  try {
    const { steps, sleepScore, hrvBalance, restingHeartRate } = await fetchOuraDailyMetrics(
      accessToken,
      startDate,
      endDate
    );

    const rows = [
      ...steps.map((p) => ({
        connection_id: connectionId,
        metric_date: p.date,
        metric_type: "steps" as const,
        value: p.value,
      })),
      ...sleepScore.map((p) => ({
        connection_id: connectionId,
        metric_date: p.date,
        metric_type: "sleep_score" as const,
        value: p.value,
      })),
      ...hrvBalance.map((p) => ({
        connection_id: connectionId,
        metric_date: p.date,
        metric_type: "hrv_balance" as const,
        value: p.value,
      })),
      ...restingHeartRate.map((p) => ({
        connection_id: connectionId,
        metric_date: p.date,
        metric_type: "resting_heart_rate" as const,
        value: p.value,
      })),
    ];

    if (rows.length > 0) {
      const { error } = await serviceRole
        .from("wearable_daily_metrics")
        .upsert(rows, { onConflict: "connection_id,metric_date,metric_type" });
      if (error) throw error;
    }
  } catch (err) {
    // Never surface this to the user — they've already been redirected
    // back to Settings by the time this runs, and the connection itself
    // is already saved and working; a failed backfill just means the
    // regular 7-day cron sync remains the only source of data until the
    // next successful run. Logged for later investigation only.
    console.error(`Oura historical backfill failed for connection ${connectionId}:`, err);
  }
}

// Oura redirects back here after the user approves (or denies) access.
// The session cookie set by /api/oura/connect's redirect is still the
// same browser tab, so the user's own auth session is still valid here —
// no need to smuggle their identity through the state param.
export async function GET(request: Request) {
  const supabase = await createServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.redirect(new URL("/login", request.url));

  const { searchParams } = new URL(request.url);
  const code = searchParams.get("code");
  const returnedState = searchParams.get("state");
  const oauthError = searchParams.get("error");

  const cookieStore = await cookies();
  const storedState = cookieStore.get("oura_oauth_state")?.value;
  const groupId = storedState?.split(".")[1];
  const settingsUrl = groupId
    ? new URL(`/groups/${groupId}/settings`, request.url)
    : new URL("/", request.url);

  if (oauthError) {
    settingsUrl.searchParams.set("oura_error", "Oura connection was cancelled.");
    return NextResponse.redirect(settingsUrl);
  }

  if (!code || !returnedState || !storedState || returnedState !== storedState) {
    settingsUrl.searchParams.set("oura_error", "Oura connection failed — please try again.");
    return NextResponse.redirect(settingsUrl);
  }

  try {
    const tokens = await exchangeOuraCode(code);
    const serviceRole = createServiceRoleClient();

    // Checked before the upsert below specifically so this can tell a
    // brand-new connection from a reconnect/re-auth of an existing one —
    // the historical backfill should only ever run once, the first time,
    // not every time a token gets refreshed via this same route.
    const { data: existingConnection } = await serviceRole
      .from("wearable_connections")
      .select("id")
      .eq("profile_id", user.id)
      .eq("provider", "oura")
      .maybeSingle();
    const isNewConnection = !existingConnection;

    const { data: connection, error: connectionError } = await serviceRole
      .from("wearable_connections")
      .upsert(
        {
          profile_id: user.id,
          provider: "oura",
          connected_at: new Date().toISOString(),
          status: "active",
        },
        { onConflict: "profile_id,provider" }
      )
      .select("id")
      .single();
    if (connectionError || !connection) throw connectionError ?? new Error("Couldn't save connection.");

    const { error: tokenError } = await serviceRole.from("wearable_oauth_tokens").upsert(
      {
        connection_id: connection.id,
        access_token: tokens.accessToken,
        refresh_token: tokens.refreshToken,
        expires_at: tokens.expiresAt,
        updated_at: new Date().toISOString(),
      },
      { onConflict: "connection_id" }
    );
    if (tokenError) throw tokenError;

    if (isNewConnection) {
      after(() => backfillHistory(connection.id, tokens.accessToken));
    }

    const response = NextResponse.redirect(settingsUrl);
    response.cookies.delete("oura_oauth_state");
    return response;
  } catch (err) {
    // The real error (which can include raw response text from Oura's own
    // API) is logged server-side only — it must never end up in a redirect
    // URL, where it would sit in browser history and any referrer header
    // for as long as that history entry exists.
    console.error("Oura OAuth callback failed:", err);
    settingsUrl.searchParams.set("oura_error", "Couldn't connect Oura — please try again.");
    return NextResponse.redirect(settingsUrl);
  }
}
