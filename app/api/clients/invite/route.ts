import { NextResponse } from "next/server";
import { createServerClient } from "@/lib/supabase/server";
import { createServiceRoleClient } from "@/lib/supabase/service-role";
import { createUnclaimedClient } from "@/lib/create-unclaimed-client";
import { dispatchWebhookEvent } from "@/lib/webhook-dispatch";
import { checkOneOnOneGroupHasRoom } from "@/lib/group-kind-guard";
import { rateLimitResponse } from "@/lib/rate-limit";

// Creates a client BEFORE they've ever signed in: a real auth account and
// profile, silently — no email is sent, so nothing reaches them until the
// coach chooses to hand over a claim link (see /api/clients/invite-link).
// Everything the coach builds (programs, schedule, credits, meal plans,
// notes) attaches to the real profile id from this moment, so it's all in
// place when the client first signs in.
//
// Only a name is required. Without an email the account gets a placeholder
// address that can never receive mail; the client enters their real one
// when they claim the account.
export async function POST(request: Request) {
  const supabase = await createServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });

  const { groupId, fullName, email } = await request.json();
  const trimmedName = typeof fullName === "string" ? fullName.trim() : "";
  const trimmedEmail = typeof email === "string" ? email.trim() : "";
  if (!groupId || !trimmedName) {
    return NextResponse.json({ error: "Missing groupId or fullName." }, { status: 400 });
  }

  const { data: membership } = await supabase
    .from("group_memberships")
    .select("role")
    .eq("group_id", groupId)
    .eq("profile_id", user.id)
    .maybeSingle();
  if (membership?.role !== "coach") {
    return NextResponse.json({ error: "Only coaches can add clients." }, { status: 403 });
  }

  // Each call creates an account, and a coach who types emails can tell which already have one. A generous
  // per-coach cap keeps real use (adding a roster) free while stopping scripted probing.
  const limited = await rateLimitResponse("client-invite", user.id, 60, 3600);
  if (limited) return limited;

  const serviceRole = createServiceRoleClient();

  // A one-on-one group that already has its client can't take another. Check BEFORE creating
  // anything, so a refusal never leaves an account behind.
  const roomError = await checkOneOnOneGroupHasRoom(serviceRole as never, groupId);
  if (roomError) return NextResponse.json({ error: roomError }, { status: 409 });

  const made = await createUnclaimedClient(serviceRole, { groupId, fullName: trimmedName, email: trimmedEmail });
  if (!made.ok) return NextResponse.json({ error: made.error }, { status: made.status });
  const newUserId = made.profileId;

  // Zapier's own "client_added" trigger (zapier_integration_queued_
  // sept16.md) — this route already knows the real coach (the caller,
  // already verified above) so it can dispatch directly rather than
  // going through /api/webhooks/dispatch's group->coach resolution.
  await dispatchWebhookEvent(serviceRole, {
    coachId: user.id,
    eventType: "client_added",
    payload: { athleteId: newUserId, fullName: trimmedName, email: trimmedEmail || null, groupId },
  });

  return NextResponse.json({ profileId: newUserId, groupId });
}
