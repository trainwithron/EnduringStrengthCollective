import { NextResponse } from "next/server";
import { createServerClient } from "@/lib/supabase/server";
import { createServiceRoleClient } from "@/lib/supabase/service-role";
import { rateLimitResponse } from "@/lib/rate-limit";
import { appOrigin } from "@/lib/app-url";
import { inviteEmail, recoveryEmail, sendAuthMail } from "@/lib/auth-mail";
import { ensureJoinLink, joinLinkUrl } from "@/lib/coach-join-link";
import { authorizeInviteManager, loadSignInTarget, markSent, sentRecently } from "@/lib/coach-invite-server";

// "Send sign-in link": works for ANY coach of the organization, in any state, and always by email. An invitation nobody has used gets its invitation again (the SAME link, moved out another 14 days). A person who has
// signed in, or never did, gets a link of the other kind, to set a new password on the join page, emailed to THEIR OWN address; that link is never shown to the person who asked, so an administrator cannot use it to become
// someone else. Opening either link changes nothing. Only an owner or admin of the organization.
export async function POST(request: Request) {
  const supabase = await createServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  const limited = await rateLimitResponse("coach-signin-link", user.id, 20, 3600);
  if (limited) return limited;

  const raw = await request.json().catch(() => null);
  const groupId = raw && typeof raw.groupId === "string" ? raw.groupId : "";
  const profileId = raw && typeof raw.profileId === "string" ? raw.profileId : "";
  const auth = await authorizeInviteManager(supabase, user.id, groupId);
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });
  if (profileId === user.id) return NextResponse.json({ error: "That is you. Use Forgot password on the sign-in page if you need a new link." }, { status: 409 });

  const db = createServiceRoleClient();
  const target = await loadSignInTarget(db, auth.manager.organizationId, profileId);
  if (!target.ok) return NextResponse.json({ error: target.error }, { status: target.status });

  const field = target.unaccepted ? "invite_emailed_at" : "signin_emailed_at";
  if (sentRecently(target.appMetadata, field)) return NextResponse.json({ error: "It was just sent. Give it a few minutes." }, { status: 429 });

  const made = await ensureJoinLink(db, { organizationId: auth.manager.organizationId, profileId, kind: target.unaccepted ? "invite" : "signin", createdBy: user.id, extend: true });
  if (!made.ok) return NextResponse.json({ error: "Couldn't get the link. Try again in a few minutes." }, { status: 502 });
  const link = joinLinkUrl(appOrigin(request), made.row.id);

  let message;
  if (target.unaccepted) {
    const { data: org } = await db.from("organizations").select("name").eq("id", auth.manager.organizationId).maybeSingle();
    message = inviteEmail({ toName: target.name, orgName: (org as { name?: string } | null)?.name ?? "an organization", inviterName: auth.manager.callerName, role: target.role, link });
  } else {
    message = recoveryEmail({ toName: target.name, link, fromCoach: auth.manager.callerName ?? "Your organization" });
  }
  const emailed = await sendAuthMail(target.email, message);
  if (emailed) await markSent(db, profileId, target.appMetadata, field);
  // the link itself is never returned
  return NextResponse.json({ ok: true, emailed, kind: target.unaccepted ? "invitation" : "sign-in" });
}
