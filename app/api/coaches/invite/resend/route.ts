import { NextResponse } from "next/server";
import { createServerClient } from "@/lib/supabase/server";
import { createServiceRoleClient } from "@/lib/supabase/service-role";
import { rateLimitResponse } from "@/lib/rate-limit";
import { appOrigin } from "@/lib/app-url";
import { inviteEmail, makeAuthLink, sendAuthMail } from "@/lib/auth-mail";
import { authorizeInviteManager, loadInviteTarget, markSent, sentRecently } from "@/lib/coach-invite-server";

// Sends the invitation again to someone who has not accepted yet: a NEW one-time link (the old one stops working) by email through the transactional mail service. Only an owner or admin of the organization.
// The person must belong to this organization and must still be unaccepted; anything else is the same plain "not found".
export async function POST(request: Request) {
  const supabase = await createServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  const limited = await rateLimitResponse("coach-invite-resend", user.id, 20, 3600);
  if (limited) return limited;

  const raw = await request.json().catch(() => null);
  const groupId = raw && typeof raw.groupId === "string" ? raw.groupId : "";
  const profileId = raw && typeof raw.profileId === "string" ? raw.profileId : "";
  const auth = await authorizeInviteManager(supabase, user.id, groupId);
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });

  const db = createServiceRoleClient();
  const target = await loadInviteTarget(db, auth.manager.organizationId, profileId);
  if (!target.ok) return NextResponse.json({ error: target.error }, { status: target.status });

  // One email per person per ten minutes, read from the account and written only AFTER a send succeeded: a double tap does not send two, and a failed attempt never locks anybody out.
  if (sentRecently(target.appMetadata, "invite_emailed_at")) return NextResponse.json({ error: "It was just sent. Give it a few minutes, or use Copy link." }, { status: 429 });

  const made = await makeAuthLink(db, { type: "invite", email: target.email, redirectTo: `${appOrigin(request)}/set-password`, fullName: target.name });
  if (!made.link) return NextResponse.json({ error: "Couldn't make a new link. Try again in a few minutes." }, { status: 502 });
  const { data: org } = await db.from("organizations").select("name").eq("id", auth.manager.organizationId).maybeSingle();
  const emailed = await sendAuthMail(
    target.email,
    inviteEmail({ toName: target.name, orgName: (org as { name?: string } | null)?.name ?? "an organization", inviterName: auth.manager.callerName, role: target.role, link: made.link })
  );
  if (emailed) await markSent(db, profileId, target.appMetadata, "invite_emailed_at");
  return NextResponse.json({ ok: true, emailed });
}
