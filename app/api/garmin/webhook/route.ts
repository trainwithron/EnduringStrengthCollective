import { NextResponse } from "next/server";
import { createServiceRoleClient } from "@/lib/supabase/service-role";
import { parseGarminWebhookPayload } from "@/lib/garmin";

// The receiving side of Garmin's push architecture — registered as this
// app's callback URL with Garmin at partner-approval time. No user
// session involved, same "auth is a shared secret header, not a login"
// shape as app/api/oura/sync/route.ts's CRON_SECRET check, but for a
// genuinely different reason: that route is called by Vercel's own
// cron, this one is called by Garmin's servers whenever a connected
// user's device syncs.
//
// Real, honest gap, not glossed over: Garmin's public developer site
// does not document how it signs or authenticates its own webhook
// deliveries (confirmed directly — see lib/garmin.ts's header comment).
// GARMIN_WEBHOOK_SECRET below is this app's own defensive placeholder —
// a shared value this app would give Garmin at partner-registration
// time, checked as a query param or header the same way many webhook
// providers support, NOT a confirmed Garmin-specific mechanism. Fails
// closed (rejects everything) if unset, same "missing config never
// silently trusts input" discipline as every other integration in this
// app. Replace with whatever real verification Garmin's partner API
// reference actually specifies once that access exists.
export async function POST(request: Request) {
  const configuredSecret = process.env.GARMIN_WEBHOOK_SECRET;
  if (!configuredSecret) {
    return NextResponse.json({ error: "Garmin webhook isn't configured." }, { status: 503 });
  }
  const { searchParams } = new URL(request.url);
  const providedSecret = request.headers.get("x-garmin-webhook-secret") ?? searchParams.get("secret");
  if (providedSecret !== configuredSecret) {
    return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
  }

  const body = await request.json().catch(() => null);
  const rows = parseGarminWebhookPayload(body);
  if (rows.length === 0) {
    // Not an error — Garmin's push architecture can deliver batches this
    // app has nothing recognizable in (a data type not yet supported, or
    // a malformed/unexpected shape it couldn't parse). Acknowledge with
    // 200 either way; Garmin's own retry behavior for a webhook isn't
    // documented, so there's no confirmed reason to return non-200 for
    // "nothing useful here" specifically, only for real auth failures.
    return NextResponse.json({ synced: 0 });
  }

  const supabase = createServiceRoleClient();

  // Resolves each push entry's externalUserId (Garmin's own access-token-
  // as-identifier — see lib/garmin.ts) back to a connection_id by
  // matching the stored access token, since Garmin's push payload
  // carries no other partner-visible user identifier per its documented
  // privacy design.
  const uniqueTokens = Array.from(new Set(rows.map((r) => r.externalUserId)));
  const { data: tokenRows } = await supabase
    .from("wearable_oauth_tokens")
    .select("connection_id, access_token")
    .in("access_token", uniqueTokens);
  const connectionIdByToken = new Map((tokenRows ?? []).map((t) => [t.access_token, t.connection_id]));

  const metricRows = rows
    .map((r) => {
      const connectionId = connectionIdByToken.get(r.externalUserId);
      if (!connectionId) return null;
      return {
        connection_id: connectionId,
        metric_date: r.date,
        metric_type: r.metricType,
        value: r.value,
      };
    })
    .filter((r): r is NonNullable<typeof r> => r !== null);

  if (metricRows.length > 0) {
    const { error } = await supabase
      .from("wearable_daily_metrics")
      .upsert(metricRows, { onConflict: "connection_id,metric_date,metric_type" });
    if (error) {
      console.error("Garmin webhook: failed to write metrics:", error);
      return NextResponse.json({ error: "Couldn't save metrics." }, { status: 500 });
    }
  }

  return NextResponse.json({ synced: metricRows.length });
}
