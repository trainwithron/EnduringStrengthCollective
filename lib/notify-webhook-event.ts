import type { WebhookEventType } from "@/lib/webhook-dispatch";

// Fire-and-forget, same convention as notifyPush/notifySms — a client
// component that just triggered a real event (a workout completed, a
// PR hit) doesn't know or care whether any Zap is even subscribed; the
// server resolves the group's coach(es) and dispatches to whichever of
// their subscriptions match. Takes groupId, not coachId, since the
// caller (e.g. an athlete completing their own workout) often doesn't
// know who the coach is — the route resolves that itself.
export function notifyWebhookEvent(groupId: string, eventType: WebhookEventType, payload: Record<string, unknown>) {
  fetch("/api/webhooks/dispatch", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ groupId, eventType, payload }),
  }).catch(() => {});
}
