import { NextResponse } from "next/server";
import { createServerClient } from "@/lib/supabase/server";
import { createServiceRoleClient } from "@/lib/supabase/service-role";
import { rateLimitResponse } from "@/lib/rate-limit";
import { authorizeInviteManager, loadInviteTarget } from "@/lib/coach-invite-server";

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

  // Their seats in this organization's groups, then the membership and the front-desk seat. An invitation has no clients and no history.
  const { data: seatsInOrg, error: seatsError } = await db.from("group_memberships").select("group_id, groups!inner(organization_id)").eq("profile_id", profileId).eq("groups.organization_id", orgId);
  if (seatsError) return NextResponse.json({ error: "Couldn't cancel that invitation. Try again." }, { status: 502 });
  for (const seat of (seatsInOrg ?? []) as { group_id: string }[]) {
    const { error } = await db.from("group_memberships").delete().eq("profile_id", profileId).eq("group_id", seat.group_id);
    if (error) return NextResponse.json({ error: "Couldn't cancel that invitation. Try again." }, { status: 502 });
  }
  await db.from("organization_memberships").delete().eq("organization_id", orgId).eq("profile_id", profileId);
  await db.from("org_front_desk").delete().eq("organization_id", orgId).eq("profile_id", profileId);

  // The never-used account goes too, unless it belongs somewhere else (another seat, another organization).
  const [{ count: seats }, { count: orgs }, { count: desks }] = await Promise.all([
    db.from("group_memberships").select("group_id", { count: "exact", head: true }).eq("profile_id", profileId),
    db.from("organization_memberships").select("organization_id", { count: "exact", head: true }).eq("profile_id", profileId),
    db.from("org_front_desk").select("profile_id", { count: "exact", head: true }).eq("profile_id", profileId),
  ]);
  if ((seats ?? 0) === 0 && (orgs ?? 0) === 0 && (desks ?? 0) === 0) {
    await db.auth.admin.deleteUser(profileId);
  }
  return NextResponse.json({ ok: true });
}
