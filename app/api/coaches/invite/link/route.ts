import { NextResponse } from "next/server";
import { createServerClient } from "@/lib/supabase/server";
import { createServiceRoleClient } from "@/lib/supabase/service-role";
import { rateLimitResponse } from "@/lib/rate-limit";
import { appOrigin } from "@/lib/app-url";
import { ensureJoinLink, joinLinkUrl } from "@/lib/coach-join-link";
import { authorizeInviteManager, loadInviteTarget } from "@/lib/coach-invite-server";

// The invitation link of a person who has not accepted yet, to copy and send yourself (a text message). It is the SAME link the email carries: copying it changes nothing, cancels nothing and can be done as often as you like.
// It works for 14 days, is used up only when the person chooses their password on its page (opening it does nothing), and is only ever shown for an account that has not signed in. Only an owner or admin of the organization.
export async function POST(request: Request) {
  const supabase = await createServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  const limited = await rateLimitResponse("coach-invite-link", user.id, 60, 3600);
  if (limited) return limited;

  const raw = await request.json().catch(() => null);
  const groupId = raw && typeof raw.groupId === "string" ? raw.groupId : "";
  const profileId = raw && typeof raw.profileId === "string" ? raw.profileId : "";
  const auth = await authorizeInviteManager(supabase, user.id, groupId);
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });

  const db = createServiceRoleClient();
  const target = await loadInviteTarget(db, auth.manager.organizationId, profileId);
  if (!target.ok) return NextResponse.json({ error: target.error }, { status: target.status });

  const made = await ensureJoinLink(db, { organizationId: auth.manager.organizationId, profileId, kind: "invite", createdBy: user.id, extend: false });
  if (!made.ok) return NextResponse.json({ error: "Couldn't get the link. Try again in a few minutes." }, { status: 502 });
  return NextResponse.json({ link: joinLinkUrl(appOrigin(request), made.row.id), expiresAt: made.row.expires_at }, { headers: { "cache-control": "no-store" } });
}
