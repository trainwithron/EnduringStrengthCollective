import { NextResponse } from "next/server";
import { createServiceRoleClient } from "@/lib/supabase/service-role";
import { attemptWebhookDelivery } from "@/lib/webhook-dispatch";
import { isDeliveryDueForRetry, MAX_WEBHOOK_ATTEMPTS } from "@/lib/webhook-retry";

// "Basic retry/failure handling" per this task's own scope — this app
// has no real job queue, so a periodic cron re-checking failed
// deliveries (exponential backoff, capped at MAX_WEBHOOK_ATTEMPTS) is
// the retry mechanism, same shape as every other cron in this project.
export async function GET(request: Request) {
  if (!process.env.CRON_SECRET) {
    return NextResponse.json({ error: "CRON_SECRET isn't configured." }, { status: 503 });
  }
  const authHeader = request.headers.get("authorization");
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
  }

  const supabase = createServiceRoleClient();
  const now = new Date();

  const { data: failedDeliveries } = await supabase
    .from("webhook_deliveries")
    .select("id, event_type, payload, attempt_count, last_attempted_at, webhook_subscriptions ( target_url )")
    .eq("status", "failed")
    .lt("attempt_count", MAX_WEBHOOK_ATTEMPTS);

  let retried = 0;
  let delivered = 0;

  for (const row of failedDeliveries ?? []) {
    const lastAttemptedAt = row.last_attempted_at ? new Date(row.last_attempted_at) : new Date(0);
    if (!isDeliveryDueForRetry(row.attempt_count, lastAttemptedAt, now)) continue;

    const targetUrl = (row as any).webhook_subscriptions?.target_url;
    if (!targetUrl) continue;

    retried += 1;
    const ok = await attemptWebhookDelivery(supabase, {
      deliveryId: row.id,
      targetUrl,
      payload: row.payload as Record<string, unknown>,
      priorAttemptCount: row.attempt_count,
    });
    if (ok) delivered += 1;
  }

  return NextResponse.json({ retried, delivered });
}
