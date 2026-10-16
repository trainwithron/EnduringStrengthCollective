import { NextResponse } from "next/server";
import { createServerClient } from "@/lib/supabase/server";
import { createServiceRoleClient } from "@/lib/supabase/service-role";
import { discardRefusal } from "@/lib/discard-empty-group";

// Removes a group the signed-in person has just made and never used: made by them in the last hour, nobody in it but them, nothing filed in it. There is no delete rule on groups for a signed-in person,
// so a client-side "delete" of such a group silently deletes nothing; this is the one place it is done, with the service role, after checking all of that.
export async function POST(request: Request) {
  const supabase = await createServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });

  const body = await request.json().catch(() => ({}));
  const groupId = typeof body.groupId === "string" ? body.groupId : "";
  if (!groupId) return NextResponse.json({ error: "Missing groupId." }, { status: 400 });

  const admin = createServiceRoleClient();
  const { data: group } = await admin.from("groups").select("id, created_by, created_at, group_kind").eq("id", groupId).maybeSingle();
  if (!group) return NextResponse.json({ ok: true, removed: false });

  const [{ data: members }, programs, sessions, posts] = await Promise.all([
    admin.from("group_memberships").select("profile_id, role").eq("group_id", groupId),
    admin.from("programs").select("id", { count: "exact", head: true }).eq("group_id", groupId),
    admin.from("athlete_sessions").select("id", { count: "exact", head: true }).eq("group_id", groupId),
    admin.from("posts").select("id", { count: "exact", head: true }).eq("group_id", groupId),
  ]);
  const others = (members ?? []).filter((m: { profile_id: string }) => m.profile_id !== user.id);
  const refusal = discardRefusal(
    {
      createdBy: (group as { created_by: string | null }).created_by,
      createdAt: (group as { created_at: string | null }).created_at,
      groupKind: (group as { group_kind: string | null }).group_kind,
      otherMembers: others.length,
      athleteMembers: others.filter((m: { role: string }) => m.role === "athlete").length,
      hasContent: (programs.count ?? 0) + (sessions.count ?? 0) + (posts.count ?? 0) > 0,
    },
    user.id
  );
  if (refusal) return NextResponse.json({ error: refusal }, { status: 409 });

  await admin.from("group_memberships").delete().eq("group_id", groupId);
  const { error } = await admin.from("groups").delete().eq("id", groupId);
  if (error) return NextResponse.json({ error: "Couldn't remove it." }, { status: 500 });
  return NextResponse.json({ ok: true, removed: true });
}
