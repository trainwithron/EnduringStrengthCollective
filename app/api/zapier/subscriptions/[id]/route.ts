import { NextResponse } from "next/server";
import { createServiceRoleClient } from "@/lib/supabase/service-role";
import { resolveCoachFromApiKey } from "@/lib/resolve-coach-from-api-key";

// Zapier's REST Hooks "unsubscribe" endpoint — called with the id this
// same coach's own POST /api/zapier/subscriptions returned, the moment
// a user turns the Zap off. Scoped to coach_id so one coach's API key
// can never delete a different coach's subscription by guessing an id.
export async function DELETE(request: Request, props: { params: Promise<{ id: string }> }) {
  const params = await props.params;
  const serviceRole = createServiceRoleClient();
  const coachId = await resolveCoachFromApiKey(serviceRole, request);
  if (!coachId) return NextResponse.json({ error: "Invalid or missing API key." }, { status: 401 });

  await serviceRole.from("webhook_subscriptions").delete().eq("id", params.id).eq("coach_id", coachId);

  return NextResponse.json({ ok: true });
}
