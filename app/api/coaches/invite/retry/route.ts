import { NextResponse } from "next/server";
import { createServerClient } from "@/lib/supabase/server";
import { createServiceRoleClient } from "@/lib/supabase/service-role";
import { rateLimitAllows, rateLimitResponse } from "@/lib/rate-limit";
import { appOrigin } from "@/lib/app-url";
import { inviteEmail, sendAuthMail } from "@/lib/auth-mail";
import { ensureJoinLink, joinLinkUrl } from "@/lib/coach-join-link";
import { authorizeInviteManager, loadInviteTarget, markSent } from "@/lib/coach-invite-server";
import { notifyAndEmail } from "@/lib/invite-notify";

// Send again / Copy link for an invitation whose email did not go out, right from the Invite coach form (desktop audit, Nov 21). The invite route hands back one id (`unsentId`) whatever kind
// of address it was: a new address (the person waiting to accept, by their id) or one that already had an account (their in-app invitation, by its id). This ONE route works out which on the
// server and answers in exactly the same shape either way, so nothing the inviter can see (the address called, the status, the keys) tells whether the address had an account.
// Only an owner or admin of the organization; the same per-person limits as the Invitations list's own buttons, plus a limit per invitation.
const NOT_OPEN = "That invitation is not open any more. Check Invitations on the Team page.";
const SEND_FAILED = "Couldn't send it again. Try again in a few minutes.";
const LINK_FAILED = "Couldn't get the link. Try again in a few minutes.";

const roleWords = (role: string) => (role === "admin" ? "an admin" : role === "front_desk" ? "front desk staff" : "a coach");

export async function POST(request: Request) {
  const supabase = await createServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  const limited = await rateLimitResponse("coach-invite-retry", user.id, 30, 3600);
  if (limited) return limited;

  const raw = await request.json().catch(() => null);
  const groupId = raw && typeof raw.groupId === "string" ? raw.groupId : "";
  const unsentId = raw && typeof raw.unsentId === "string" ? raw.unsentId : "";
  const action = raw?.action === "resend" || raw?.action === "link" ? (raw.action as "resend" | "link") : null;
  if (!unsentId || !action) return NextResponse.json({ error: "Missing the invitation." }, { status: 400 });
  const auth = await authorizeInviteManager(supabase, user.id, groupId);
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });
  const organizationId = auth.manager.organizationId;
  const db = createServiceRoleClient();
  const origin = appOrigin(request);

  // Which kind it is, read on the server only: an open in-app invitation of this organization, else an unaccepted person of this organization. Anything else is the same one answer.
  const { data: invite } = await db.from("organization_invites").select("id, invited_profile_id, role, answered_at").eq("id", unsentId).eq("organization_id", organizationId).maybeSingle();
  const openInvite = invite && !(invite as { answered_at: string | null }).answered_at ? (invite as { id: string; invited_profile_id: string; role: string }) : null;
  const person = openInvite ? null : await loadInviteTarget(db, organizationId, unsentId);
  if (!openInvite && !person?.ok) return NextResponse.json({ error: NOT_OPEN }, { status: 404 });

  if (action === "link") {
    let link: string | null = null;
    if (openInvite) link = `${origin}/org-invite/${openInvite.id}`;
    else {
      const made = await ensureJoinLink(db, { organizationId, profileId: unsentId, kind: "invite", createdBy: user.id, extend: false });
      link = made.ok ? joinLinkUrl(origin, made.row.id) : null;
    }
    if (!link) return NextResponse.json({ error: LINK_FAILED }, { status: 502 });
    return NextResponse.json({ ok: true, link }, { headers: { "cache-control": "no-store" } });
  }

  // Sending again: a few times per invitation per ten minutes, the same for both kinds.
  if (!(await rateLimitAllows(`coach-invite-retry:${unsentId}`, 3, 600))) return NextResponse.json({ error: "It was just sent. Give it a few minutes." }, { status: 429 });
  const { data: org } = await db.from("organizations").select("name").eq("id", organizationId).maybeSingle();
  const orgName = (org as { name?: string } | null)?.name ?? "An organization";
  let emailed = false;
  if (openInvite) {
    // the same as the Invitations list's Send again: fourteen more days (the database checks the caller), then a notice in the app and an email
    const { error: extendError } = await supabase.rpc("extend_org_invite", { p_invite: openInvite.id });
    if (extendError) return NextResponse.json({ error: SEND_FAILED }, { status: 502 });
    const sent = await notifyAndEmail(db, {
      profileId: openInvite.invited_profile_id,
      type: "organization_invite",
      body: `${orgName} invited you to join as ${roleWords(openInvite.role)}.`,
      linkPath: `/org-invite/${openInvite.id}`,
      origin,
      subject: `${orgName} invited you to join`,
    });
    emailed = sent.emailed;
  } else if (person?.ok) {
    // the same as the Invitations list's Email it: the SAME join link, good for another 14 days
    const made = await ensureJoinLink(db, { organizationId, profileId: unsentId, kind: "invite", createdBy: user.id, extend: true });
    if (!made.ok) return NextResponse.json({ error: SEND_FAILED }, { status: 502 });
    emailed = await sendAuthMail(person.email, inviteEmail({ toName: person.name, orgName, inviterName: auth.manager.callerName, role: person.role, link: joinLinkUrl(origin, made.row.id) }));
    if (emailed) await markSent(db, unsentId, person.appMetadata, "invite_emailed_at");
  }
  return NextResponse.json({ ok: true, emailed });
}
