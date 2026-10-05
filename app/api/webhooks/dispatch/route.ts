import { NextResponse } from "next/server";
import { createServerClient } from "@/lib/supabase/server";
import { createServiceRoleClient } from "@/lib/supabase/service-role";
import { dispatchWebhookEvent } from "@/lib/webhook-dispatch";
import { getCallerGroupRole } from "@/lib/group-access";
import { rateLimitAllows } from "@/lib/rate-limit";

// Only these two events can be raised from a browser. client_added and package_purchased are dispatched by the
// server routes that actually perform them (clients/invite, the Stripe webhook), never from here.
const CLIENT_EVENT_TYPES = ["workout_completed", "pr_hit"] as const;
type ClientEventType = (typeof CLIENT_EVENT_TYPES)[number];

// A completion is announced right after it happens; anything older than this isn't a fresh event.
const FRESH_WINDOW_MS = 30 * 60 * 1000;

// Fired by lib/notify-webhook-event.ts right after a workout is completed. The route does not trust what the
// caller says happened: it looks up the workout log itself, requires that it belongs to this group, was just
// completed, and was completed by the caller (or by a coach of the group on a client's behalf), and builds the
// payload from that row. Dispatch then goes to every coach of the group with their own subscriptions, using the
// service role because those subscriptions belong to the coaches, not the caller.
export async function POST(request: Request) {
  const supabase = await createServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });

  const { groupId, eventType, payload } = await request.json();
  if (!groupId || !CLIENT_EVENT_TYPES.includes(eventType)) {
    return NextResponse.json({ error: "Missing groupId or invalid eventType." }, { status: 400 });
  }
  const workoutLogId = payload && typeof payload === "object" ? (payload as { workoutLogId?: unknown }).workoutLogId : null;
  if (typeof workoutLogId !== "string" || workoutLogId.length === 0) {
    return NextResponse.json({ error: "Missing workoutLogId." }, { status: 400 });
  }

  const role = await getCallerGroupRole(supabase, user.id, groupId);
  if (!role) return NextResponse.json({ error: "Not allowed." }, { status: 403 });

  const { data: log } = await supabase
    .from("workout_logs")
    .select("id, athlete_id, group_id, total_volume, total_sets_completed, new_prs, created_at")
    .eq("id", workoutLogId)
    .maybeSingle();
  const fresh = log && Date.now() - new Date(log.created_at as string).getTime() <= FRESH_WINDOW_MS;
  const ownsIt = log && (log.athlete_id === user.id || role === "coach");
  if (!log || log.group_id !== groupId || !fresh || !ownsIt) {
    return NextResponse.json({ error: "Not allowed." }, { status: 403 });
  }

  // Once per workout log per event: inside the 30-minute window the same real log could otherwise be announced again
  // and again.
  if (!(await rateLimitAllows(`webhook-dispatch:${eventType}:${log.id}`, 1, 24 * 3600))) {
    return NextResponse.json({ dispatched: 0, duplicate: true });
  }

  const prs = (log.new_prs as string[] | null) ?? [];
  const type = eventType as ClientEventType;
  if (type === "pr_hit" && prs.length === 0) {
    return NextResponse.json({ error: "No PR on that workout." }, { status: 400 });
  }
  const eventPayload =
    type === "pr_hit"
      ? { athleteId: log.athlete_id, workoutLogId: log.id, exercises: prs }
      : {
          athleteId: log.athlete_id,
          workoutLogId: log.id,
          totalVolume: log.total_volume,
          totalSetsCompleted: log.total_sets_completed,
        };

  const serviceRole = createServiceRoleClient();
  const { data: coachRows } = await serviceRole
    .from("group_memberships")
    .select("profile_id")
    .eq("group_id", groupId)
    .eq("role", "coach");

  for (const row of coachRows ?? []) {
    await dispatchWebhookEvent(serviceRole, {
      coachId: row.profile_id,
      eventType: type,
      payload: eventPayload,
    });
  }

  return NextResponse.json({ dispatched: (coachRows ?? []).length });
}
