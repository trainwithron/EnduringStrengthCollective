import { NextResponse } from "next/server";
import { createServerClient } from "@/lib/supabase/server";
import { createServiceRoleClient } from "@/lib/supabase/service-role";
import { toFriendlyAuthEmailError } from "@/lib/auth-email-error";
import { placeholderEmailFor } from "@/lib/client-claim";
import { dispatchWebhookEvent } from "@/lib/webhook-dispatch";
import { checkOneOnOneGroupHasRoom } from "@/lib/group-kind-guard";

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

  const serviceRole = createServiceRoleClient();

  // A one-on-one group that already has its client can't take another. Check BEFORE creating
  // anything, so a refusal never leaves an account behind.
  const roomError = await checkOneOnOneGroupHasRoom(serviceRole as never, groupId);
  if (roomError) return NextResponse.json({ error: roomError }, { status: 409 });

  const { data: created, error: createError } = await serviceRole.auth.admin.createUser({
    email: trimmedEmail || placeholderEmailFor(crypto.randomUUID()),
    email_confirm: true,
    user_metadata: { full_name: trimmedName },
  });

  if (createError || !created?.user) {
    const raw = createError?.message ?? "Couldn't add this client.";
    if (/already|registered|exists/i.test(raw)) {
      return NextResponse.json(
        {
          error:
            "That email already has an account. Use an invite link instead so they join with their own login.",
        },
        { status: 409 }
      );
    }
    const { error, status } = toFriendlyAuthEmailError(raw);
    return NextResponse.json({ error }, { status });
  }

  const newUserId = created.user.id;

  // claimed_at = null marks the account as not yet signed into.
  const { error: profileError } = await serviceRole
    .from("profiles")
    .insert({ id: newUserId, full_name: trimmedName, intake_required: true, claimed_at: null });
  if (profileError) {
    await serviceRole.auth.admin.deleteUser(newUserId).catch(() => {});
    return NextResponse.json({ error: `Couldn't create their profile: ${profileError.message}` }, { status: 502 });
  }

  const { error: membershipError } = await serviceRole
    .from("group_memberships")
    .insert({ group_id: groupId, profile_id: newUserId, role: "athlete" });
  if (membershipError) {
    // Don't leave a half-made client behind (an account with a placeholder email and no group).
    // Deleting the auth user removes its profile with it.
    await serviceRole.auth.admin.deleteUser(newUserId).catch(() => {});
    return NextResponse.json(
      { error: `Couldn't add them to the group: ${membershipError.message}` },
      { status: 502 }
    );
  }

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
