import { NextResponse } from "next/server";
import { createServerClient } from "@/lib/supabase/server";
import { createServiceRoleClient } from "@/lib/supabase/service-role";
import { rateLimitResponse } from "@/lib/rate-limit";
import { appOrigin } from "@/lib/app-url";
import { inviteEmail, makeAuthLink, recoveryEmail, sendAuthMail } from "@/lib/auth-mail";
import { authorizeInviteManager, loadSignInTarget, markSent, sentRecently } from "@/lib/coach-invite-server";

// "Send sign-in link": works for ANY coach of the organization, in any state. An invitation nobody has used gets the invitation again (a new one-time link, by email). A person who has already signed in, or never did, gets a
// sign-in / password link by email to THEIR OWN address; the link is never shown to the person who asked, so an administrator cannot use it to become someone else. Only an owner or admin of the organization.
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

  const redirectTo = `${appOrigin(request)}/set-password`;
  if (target.unaccepted) {
    const made = await makeAuthLink(db, { type: "invite", email: target.email, redirectTo, fullName: target.name });
    if (!made.link) return NextResponse.json({ error: "Couldn't make a new link. Try again in a few minutes." }, { status: 502 });
    const { data: org } = await db.from("organizations").select("name").eq("id", auth.manager.organizationId).maybeSingle();
    const emailed = await sendAuthMail(
      target.email,
      inviteEmail({ toName: target.name, orgName: (org as { name?: string } | null)?.name ?? "an organization", inviterName: auth.manager.callerName, role: target.role, link: made.link })
    );
    if (emailed) await markSent(db, profileId, target.appMetadata, field);
    return NextResponse.json({ ok: true, emailed, kind: "invitation" });
  }

  const made = await makeAuthLink(db, { type: "recovery", email: target.email, redirectTo });
  if (!made.link) return NextResponse.json({ error: "Couldn't make a sign-in link. Try again in a few minutes." }, { status: 502 });
  const emailed = await sendAuthMail(target.email, recoveryEmail({ toName: target.name, link: made.link, fromCoach: auth.manager.callerName ?? "Your organization" }));
  if (emailed) await markSent(db, profileId, target.appMetadata, field);
  // the link itself is never returned
  return NextResponse.json({ ok: true, emailed, kind: "sign-in" });
}
