import { NextResponse } from "next/server";
import { createServiceRoleClient } from "@/lib/supabase/service-role";
import { resolveCoachFromApiKey } from "@/lib/resolve-coach-from-api-key";

const VALID_EVENT_TYPES = ["client_added", "workout_completed", "pr_hit", "package_purchased"];

// Zapier's REST Hooks "subscribe" endpoint (docs.zapier.com/integrations/
// build/hook-trigger): Zapier's platform calls this the moment a user
// turns a Zap on, with the callback URL it wants events POSTed to.
// Returns an id (Zapier's own convention expects one back) so the
// matching DELETE below knows which row to remove on unsubscribe.
export async function POST(request: Request) {
  const serviceRole = createServiceRoleClient();
  const coachId = await resolveCoachFromApiKey(serviceRole, request);
  if (!coachId) return NextResponse.json({ error: "Invalid or missing API key." }, { status: 401 });

  const { event, target_url } = await request.json();
  if (!VALID_EVENT_TYPES.includes(event) || typeof target_url !== "string" || !target_url) {
    return NextResponse.json({ error: "Missing or invalid event/target_url." }, { status: 400 });
  }

  const { data, error } = await serviceRole
    .from("webhook_subscriptions")
    .insert({ coach_id: coachId, event_type: event, target_url })
    .select("id")
    .single();
  if (error || !data) {
    return NextResponse.json({ error: "Couldn't create subscription." }, { status: 500 });
  }

  return NextResponse.json({ id: data.id });
}

// Not part of the REST Hooks contract itself, but a real, cheap thing
// to expose for debugging/support — "what is this coach's Zapier app
// actually subscribed to right now."
export async function GET(request: Request) {
  const serviceRole = createServiceRoleClient();
  const coachId = await resolveCoachFromApiKey(serviceRole, request);
  if (!coachId) return NextResponse.json({ error: "Invalid or missing API key." }, { status: 401 });

  const { data } = await serviceRole
    .from("webhook_subscriptions")
    .select("id, event_type, target_url, created_at")
    .eq("coach_id", coachId);

  return NextResponse.json({ subscriptions: data ?? [] });
}
