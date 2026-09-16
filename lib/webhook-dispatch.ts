import type { SupabaseClient } from "@supabase/supabase-js";

export type WebhookEventType = "client_added" | "workout_completed" | "pr_hit" | "package_purchased";

// The real net-new piece for the Zapier build: this app has never been
// the SERVER other software calls into before (the Stripe webhook
// handler is the reverse direction — inbound). Every tracked event
// fans out to every one of this coach's active subscriptions for that
// event type. A coach with no Zaps subscribed pays nothing extra —
// zero rows means this returns immediately.
export async function dispatchWebhookEvent(
  supabase: SupabaseClient,
  params: { coachId: string; eventType: WebhookEventType; payload: Record<string, unknown> }
): Promise<void> {
  const { data: subscriptions } = await supabase
    .from("webhook_subscriptions")
    .select("id, target_url")
    .eq("coach_id", params.coachId)
    .eq("event_type", params.eventType);

  if (!subscriptions || subscriptions.length === 0) return;

  for (const subscription of subscriptions) {
    const { data: delivery } = await supabase
      .from("webhook_deliveries")
      .insert({
        subscription_id: subscription.id,
        event_type: params.eventType,
        payload: params.payload,
      })
      .select("id")
      .single();
    if (!delivery) continue;

    // A brand-new delivery row always starts at attempt_count 0.
    await attemptWebhookDelivery(supabase, {
      deliveryId: delivery.id,
      targetUrl: subscription.target_url,
      payload: params.payload,
      priorAttemptCount: 0,
    });
  }
}

// Shared by the initial dispatch above and /api/cron/webhook-retry — one
// real POST attempt, always recording the outcome (never silently
// dropped) so a failed delivery has a real row to retry from.
// `priorAttemptCount` is the count BEFORE this attempt — the row is
// updated to priorAttemptCount + 1 regardless of outcome, so a retried
// delivery's count keeps climbing toward MAX_WEBHOOK_ATTEMPTS instead of
// resetting to 1 every time.
export async function attemptWebhookDelivery(
  supabase: SupabaseClient,
  params: { deliveryId: string; targetUrl: string; payload: Record<string, unknown>; priorAttemptCount: number }
): Promise<boolean> {
  let delivered = false;
  try {
    const res = await fetch(params.targetUrl, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(params.payload),
    });
    delivered = res.ok;
  } catch {
    delivered = false;
  }

  await supabase
    .from("webhook_deliveries")
    .update({
      status: delivered ? "delivered" : "failed",
      attempt_count: params.priorAttemptCount + 1,
      last_attempted_at: new Date().toISOString(),
    })
    .eq("id", params.deliveryId);

  return delivered;
}
