import { NextResponse } from "next/server";
import { createServerClient } from "@/lib/supabase/server";
import { createServiceRoleClient } from "@/lib/supabase/service-role";
import { dispatchWebhookEvent, type WebhookEventType } from "@/lib/webhook-dispatch";

const VALID_EVENT_TYPES: WebhookEventType[] = ["client_added", "workout_completed", "pr_hit", "package_purchased"];

// Fired by lib/notify-webhook-event.ts from client components right
// after a real event happens (a workout completed, a PR hit) — same
// "client already knows exactly what just happened" pattern as every
// other notify-*.ts helper in this app. Requires only a signed-in
// session (not necessarily the coach) since the actual event usually
// belongs to the athlete who triggered it; the real privileged work
// (reading webhook_subscriptions, writing webhook_deliveries) happens
// via the service-role client, same split as /api/sms/*.
//
// Resolves EVERY coach of the group, not just one — a group with
// co-coaches dispatches to each coach's own independent subscriptions,
// same "every recipient's own config, independently" shape already
// used for the low-credit SMS alert.
export async function POST(request: Request) {
  const supabase = await createServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });

  const { groupId, eventType, payload } = await request.json();
  if (!groupId || !VALID_EVENT_TYPES.includes(eventType)) {
    return NextResponse.json({ error: "Missing groupId or invalid eventType." }, { status: 400 });
  }

  const serviceRole = createServiceRoleClient();

  const { data: coachRows } = await serviceRole
    .from("group_memberships")
    .select("profile_id")
    .eq("group_id", groupId)
    .eq("role", "coach");

  for (const row of coachRows ?? []) {
    await dispatchWebhookEvent(serviceRole, {
      coachId: row.profile_id,
      eventType,
      payload: payload ?? {},
    });
  }

  return NextResponse.json({ dispatched: (coachRows ?? []).length });
}
