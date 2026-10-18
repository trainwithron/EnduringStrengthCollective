import { NextResponse } from "next/server";
import { createServerClient } from "@/lib/supabase/server";
import { createServiceRoleClient } from "@/lib/supabase/service-role";
import { rateLimitResponse } from "@/lib/rate-limit";
import { authorizeInviteManager, inviteOnlyFootprint, loadInviteTarget } from "@/lib/coach-invite-server";

// Cancels an invitation nobody has accepted: the person is taken out of this organization (their coach seats in its groups, the membership, a front-desk seat), and the never-used account is deleted when nothing
// else belongs to it. Only an owner or admin; only a person who has not accepted yet (someone who has is removed with Remove on the Team page, which also hands over clients).
export async function POST(request: Request) {
  const supabase = await createServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  const limited = await rateLimitResponse("coach-invite-cancel", user.id, 30, 3600);
  if (limited) return limited;

  const raw = await request.json().catch(() => null);
  const groupId = raw && typeof raw.groupId === "string" ? raw.groupId : "";
  const profileId = raw && typeof raw.profileId === "string" ? raw.profileId : "";
  const auth = await authorizeInviteManager(supabase, user.id, groupId);
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });
  const orgId = auth.manager.organizationId;

  const db = createServiceRoleClient();
  const target = await loadInviteTarget(db, orgId, profileId);
  if (!target.ok) return NextResponse.json({ error: target.error }, { status: target.status });

  // Only an account that exists solely because this organization invited it, and has made nothing, can be cancelled (it is deleted, and its seats go with it). Anything else is removed with Remove on the Team page.
  const footprint = await inviteOnlyFootprint(db, orgId, profileId, { withData: true });
  if (!footprint.ok) return NextResponse.json({ error: "This person can't be cancelled here. Use Remove on the Team page." }, { status: 409 });
  const { error: deleteError } = await db.auth.admin.deleteUser(profileId);
  // A delete that failed is a cancel that did not happen: nothing was changed, so the invitation stays.
  if (deleteError) return NextResponse.json({ error: "Couldn't cancel that invitation. Try again." }, { status: 502 });
  return NextResponse.json({ ok: true });
}
