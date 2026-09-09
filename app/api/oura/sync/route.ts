import { NextResponse } from "next/server";
import { createServiceRoleClient } from "@/lib/supabase/service-role";
import { fetchOuraDailyMetrics, refreshOuraTokens } from "@/lib/oura";

const SYNC_WINDOW_DAYS = 7;

function todayIso() {
  return new Date().toISOString().slice(0, 10);
}

function daysAgoIso(days: number) {
  const d = new Date();
  d.setDate(d.getDate() - days);
  return d.toISOString().slice(0, 10);
}

// Triggered daily by the Vercel Cron entry in vercel.json. No user
// session involved — auth is the CRON_SECRET header, same role a
// signature check plays for the Stripe webhook. Polls the last week of
// data (not just yesterday) so a missed run or a late-finalizing Oura
// summary still gets picked up on the next sync.
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
    .from("wearable_connections")
    .select("id, wearable_oauth_tokens ( access_token, refresh_token, expires_at )")
    .eq("provider", "oura")
    .eq("status", "active");

  if (connectionsError) {
    return NextResponse.json({ error: connectionsError.message }, { status: 500 });
  }

  const startDate = daysAgoIso(SYNC_WINDOW_DAYS);
  const endDate = todayIso();
  const results: { connectionId: string; ok: boolean; error?: string }[] = [];

  for (const connection of connections ?? []) {
    const tokenRow = Array.isArray(connection.wearable_oauth_tokens)
      ? connection.wearable_oauth_tokens[0]
      : connection.wearable_oauth_tokens;

    if (!tokenRow) {
      results.push({ connectionId: connection.id, ok: false, error: "No tokens on file." });
      continue;
    }

    try {
      let accessToken = tokenRow.access_token;

      // Refresh a bit ahead of the real expiry so a slow request doesn't
      // land mid-refresh window.
      const expiresSoon = new Date(tokenRow.expires_at).getTime() - Date.now() < 5 * 60 * 1000;
      if (expiresSoon) {
        const refreshed = await refreshOuraTokens(tokenRow.refresh_token);
        accessToken = refreshed.accessToken;
        await supabase
          .from("wearable_oauth_tokens")
          .update({
            access_token: refreshed.accessToken,
            refresh_token: refreshed.refreshToken,
            expires_at: refreshed.expiresAt,
            updated_at: new Date().toISOString(),
          })
          .eq("connection_id", connection.id);
      }

      const { steps, sleepScore } = await fetchOuraDailyMetrics(accessToken, startDate, endDate);

      const rows = [
        ...steps.map((p) => ({
          connection_id: connection.id,
          metric_date: p.date,
          metric_type: "steps" as const,
          value: p.value,
        })),
        ...sleepScore.map((p) => ({
          connection_id: connection.id,
          metric_date: p.date,
          metric_type: "sleep_score" as const,
          value: p.value,
        })),
      ];

      if (rows.length > 0) {
        const { error: upsertError } = await supabase
          .from("wearable_daily_metrics")
          .upsert(rows, { onConflict: "connection_id,metric_date,metric_type" });
        if (upsertError) throw upsertError;
      }

      results.push({ connectionId: connection.id, ok: true });
    } catch (err) {
      const message = err instanceof Error ? err.message : "Unknown error";
      results.push({ connectionId: connection.id, ok: false, error: message });
      // A refresh failure almost always means the user revoked access on
      // Oura's end — mark it so the UI stops presenting this as connected
      // instead of silently retrying forever.
      if (message.includes("refresh")) {
        await supabase.from("wearable_connections").update({ status: "error" }).eq("id", connection.id);
      }
    }
  }

  return NextResponse.json({ synced: results.length, results });
}
