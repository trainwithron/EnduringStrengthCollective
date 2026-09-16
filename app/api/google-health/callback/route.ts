import { NextResponse, after } from "next/server";
import { cookies } from "next/headers";
import { createServerClient } from "@/lib/supabase/server";
import { createServiceRoleClient } from "@/lib/supabase/service-role";
import { exchangeGoogleHealthCode, fetchGoogleHealthDailyMetrics } from "@/lib/google-health";

// Mirrors app/api/oura/callback/route.ts exactly, including the one-time
// historical backfill on a brand-new connection (Google Health is a
// polled REST API like Oura/Withings, not push-based like Garmin, so a
// backfill call is real and possible here).
const BACKFILL_WINDOW_DAYS = 90;

function daysAgoIso(days: number) {
  const d = new Date();
  d.setDate(d.getDate() - days);
  return d.toISOString().slice(0, 10);
}

async function backfillHistory(connectionId: string, accessToken: string) {
  const serviceRole = createServiceRoleClient();
  const startDate = daysAgoIso(BACKFILL_WINDOW_DAYS);
  const endDate = new Date().toISOString().slice(0, 10);

  try {
    const { steps, sleepScore, restingHeartRate, weight } = await fetchGoogleHealthDailyMetrics(
      accessToken,
      startDate,
      endDate
    );

    const rows = [
      ...steps.map((p) => ({ connection_id: connectionId, metric_date: p.date, metric_type: "steps" as const, value: p.value })),
      ...sleepScore.map((p) => ({ connection_id: connectionId, metric_date: p.date, metric_type: "sleep_score" as const, value: p.value })),
      ...restingHeartRate.map((p) => ({ connection_id: connectionId, metric_date: p.date, metric_type: "resting_heart_rate" as const, value: p.value })),
      ...weight.map((p) => ({ connection_id: connectionId, metric_date: p.date, metric_type: "weight" as const, value: p.value })),
    ];

    if (rows.length > 0) {
      const { error } = await serviceRole
        .from("wearable_daily_metrics")
        .upsert(rows, { onConflict: "connection_id,metric_date,metric_type" });
      if (error) throw error;
    }
  } catch (err) {
    console.error(`Google Health historical backfill failed for connection ${connectionId}:`, err);
  }
}

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
  const storedState = cookieStore.get("google_health_oauth_state")?.value;
  const groupId = storedState?.split(".")[1];
  const settingsUrl = groupId
    ? new URL(`/groups/${groupId}/settings`, request.url)
    : new URL("/", request.url);

  if (oauthError) {
    settingsUrl.searchParams.set("google_health_error", "Google Health connection was cancelled.");
    return NextResponse.redirect(settingsUrl);
  }

  if (!code || !returnedState || !storedState || returnedState !== storedState) {
    settingsUrl.searchParams.set("google_health_error", "Google Health connection failed — please try again.");
    return NextResponse.redirect(settingsUrl);
  }

  try {
    const tokens = await exchangeGoogleHealthCode(code);
    const serviceRole = createServiceRoleClient();

    const { data: existingConnection } = await serviceRole
      .from("wearable_connections")
      .select("id")
      .eq("profile_id", user.id)
      .eq("provider", "google_health")
      .maybeSingle();
    const isNewConnection = !existingConnection;

    const { data: connection, error: connectionError } = await serviceRole
      .from("wearable_connections")
      .upsert(
        {
          profile_id: user.id,
          provider: "google_health",
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
    response.cookies.delete("google_health_oauth_state");
    return response;
  } catch (err) {
    console.error("Google Health OAuth callback failed:", err);
    settingsUrl.searchParams.set("google_health_error", "Couldn't connect Google Health — please try again.");
    return NextResponse.redirect(settingsUrl);
  }
}
