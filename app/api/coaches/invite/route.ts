import { NextResponse } from "next/server";
import { createServerClient } from "@/lib/supabase/server";
import { createServiceRoleClient } from "@/lib/supabase/service-role";
import { toFriendlyAuthEmailError } from "@/lib/auth-email-error";
import { appOrigin } from "@/lib/app-url";
import { rateLimitResponse } from "@/lib/rate-limit";
import { notifyAndEmail } from "@/lib/invite-notify";
import { inviteEmail, makeAuthLink, sendAuthMail } from "@/lib/auth-mail";

// Which org-level role an invite can grant. "owner" is set once at
// org creation and never assigned through this flow.
// "front_desk" (Release T1) is not an organization role: it makes a row in org_front_desk (check-in only), never a membership or a group seat.
const INVITABLE_ORG_ROLES = new Set(["admin", "coach", "front_desk"]);

export async function POST(request: Request) {
  const supabase = await createServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });

  // Each call creates an account and sends an invitation email to an address that never asked for it, so it is limited per person, per hour and per day.
  const limitedHour = await rateLimitResponse("coach-invite-hour", user.id, 10, 3600);
  if (limitedHour) return limitedHour;
  const limitedDay = await rateLimitResponse("coach-invite-day", user.id, 30, 86400);
  if (limitedDay) return limitedDay;

  const { groupId, fullName, email, orgRole } = await request.json();
  const trimmedName = typeof fullName === "string" ? fullName.trim() : "";
  const trimmedEmail = typeof email === "string" ? email.trim() : "";
  const role = INVITABLE_ORG_ROLES.has(orgRole) ? orgRole : "coach";
  if (!groupId || !trimmedName || !trimmedEmail) {
    return NextResponse.json({ error: "Missing groupId, fullName, or email." }, { status: 400 });
  }

  const { data: group } = await supabase
    .from("groups")
    .select("organization_id, group_kind")
    .eq("id", groupId)
    .maybeSingle();
  if (!group?.organization_id) {
    return NextResponse.json({ error: "This group isn't part of an organization." }, { status: 400 });
  }
  // A one-on-one space belongs to its client and their coach: an organization admin can't add another coach to it.
  if (group.group_kind === "one_on_one" && role !== "front_desk") {
    return NextResponse.json({ error: "You can't add a coach to a one-on-one space." }, { status: 400 });
  }

  const { data: callerOrgMembership } = await supabase
    .from("organization_memberships")
    .select("role")
    .eq("organization_id", group.organization_id)
    .eq("profile_id", user.id)
    .maybeSingle();
  if (callerOrgMembership?.role !== "owner" && callerOrgMembership?.role !== "admin") {
    return NextResponse.json(
      { error: "Only an organization owner or admin can invite coaches." },
      { status: 403 }
    );
  }

  const serviceRole = createServiceRoleClient();
  // ...or to a group that holds a client who is private from the organization.
  const { count: privateClients } = role === "front_desk"
    ? { count: 0 }
    : await serviceRole
        .from("group_memberships")
        .select("profile_id", { count: "exact", head: true })
        .eq("group_id", groupId)
        .eq("role", "athlete")
        .eq("private_from_org", true);
  if ((privateClients ?? 0) > 0) {
    return NextResponse.json({ error: "This group has a client who is private from the organization, so a coach can't be added to it." }, { status: 400 });
  }
  // Someone who already has an account is not put into the organization: they get an invitation they accept or decline (Release BD). Only a brand-new address is invited by email below,
  // and that person joins by setting their own password.
  const { data: existingId } = await serviceRole.rpc("profile_id_for_email", { p_email: trimmedEmail });
  if (typeof existingId === "string" && existingId) {
    const { data: already } =
      role === "front_desk"
        ? await serviceRole.from("org_front_desk").select("profile_id").eq("organization_id", group.organization_id).eq("profile_id", existingId).maybeSingle()
        : await serviceRole.from("organization_memberships").select("id").eq("organization_id", group.organization_id).eq("profile_id", existingId).maybeSingle();
    // The answer is the same whether or not the address has an account (or is already a member), so an organization cannot be used to find out who has an account.
    if (already) return NextResponse.json({ invited: true });
    const { data: invite, error: inviteRowError } = await serviceRole
      .from("organization_invites")
      .insert({ organization_id: group.organization_id, invited_profile_id: existingId, role, group_id: role === "front_desk" ? null : groupId, created_by: user.id })
      .select("id")
      .single();
    if (inviteRowError || !invite) {
      // An open invitation already exists: answer exactly as if it was just sent. The answer never depends on whether an address has an account; the real state is the Invitations list the owner sees on the Team page.
      if (inviteRowError?.code === "23505") return NextResponse.json({ invited: true });
      return NextResponse.json({ error: "Couldn't send the invitation. Try again." }, { status: 502 });
    }
    const { data: orgRow } = await serviceRole.from("organizations").select("name").eq("id", group.organization_id).maybeSingle();
    // An in-app notice and an email to the address on the account. The answer to the caller is the same either way.
    const sent = await notifyAndEmail(serviceRole, {
      profileId: existingId,
      type: "organization_invite",
      body: `${orgRow?.name ?? "An organization"} invited you to join as ${role === "admin" ? "an admin" : role === "front_desk" ? "front desk staff" : "a coach"}.`,
      linkPath: `/org-invite/${invite.id}`,
      origin: appOrigin(request),
      subject: `${orgRow?.name ?? "An organization"} invited you to join`,
    });
    // Same shape as the new-address answer below: whether the email went out, never whether the address has an account. (A failed email is told to the person who invited, so they can send it again.)
    return NextResponse.json({ invited: true, emailed: sent.emailed });
  }
  const origin = appOrigin(request);

  // The account and its one-time link are made here, and the email is sent by US through the transactional mail service (Brevo), so it does not depend on the auth service's own mailer (a few emails an hour, no
  // domain authentication). A link that was made but not delivered is told to the person inviting, who can send it again or copy it from the Invitations list.
  const made = await makeAuthLink(serviceRole, { type: "invite", email: trimmedEmail, redirectTo: `${origin}/set-password`, fullName: trimmedName });
  if (!made.link || !made.userId) {
    const { error, status } = toFriendlyAuthEmailError(made.error ?? "Couldn't invite this coach.");
    return NextResponse.json({ error }, { status });
  }

  const newUserId = made.userId;
  const { data: orgForMail } = await serviceRole.from("organizations").select("name").eq("id", group.organization_id).maybeSingle();
  const { data: inviterRow } = await serviceRole.from("profiles").select("full_name").eq("id", user.id).maybeSingle();
  const emailTheInvite = () =>
    sendAuthMail(
      trimmedEmail,
      inviteEmail({
        toName: trimmedName,
        orgName: (orgForMail as { name?: string } | null)?.name ?? "an organization",
        inviterName: (inviterRow as { full_name?: string | null } | null)?.full_name ?? null,
        role,
        link: made.link as string,
      })
    );

  const { error: profileError } = await serviceRole
    .from("profiles")
    .insert({ id: newUserId, full_name: trimmedName });
  if (profileError) {
    return NextResponse.json({ error: `Couldn't create their profile: ${profileError.message}` }, { status: 502 });
  }

  if (role === "front_desk") {
    const { error: frontDeskError } = await serviceRole.from("org_front_desk").insert({ organization_id: group.organization_id, profile_id: newUserId, added_by: user.id });
    if (frontDeskError) {
      return NextResponse.json({ error: `Couldn't add them to the front desk: ${frontDeskError.message}` }, { status: 502 });
    }
    const emailedDesk = await emailTheInvite();
    return NextResponse.json({ invited: true, emailed: emailedDesk });
  }

  const { error: groupMembershipError } = await serviceRole
    .from("group_memberships")
    .insert({ group_id: groupId, profile_id: newUserId, role: "coach" });
  if (groupMembershipError) {
    return NextResponse.json(
      { error: `Couldn't add them to the group: ${groupMembershipError.message}` },
      { status: 502 }
    );
  }

  const { error: orgMembershipError } = await serviceRole
    .from("organization_memberships")
    .insert({ organization_id: group.organization_id, profile_id: newUserId, role });
  if (orgMembershipError) {
    return NextResponse.json(
      { error: `Couldn't add them to the organization: ${orgMembershipError.message}` },
      { status: 502 }
    );
  }

  const emailed = await emailTheInvite();
  return NextResponse.json({ invited: true, emailed });
}
