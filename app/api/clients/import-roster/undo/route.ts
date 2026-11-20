import { NextResponse } from "next/server";
import { createServerClient } from "@/lib/supabase/server";
import { createServiceRoleClient } from "@/lib/supabase/service-role";
import { rateLimitResponse } from "@/lib/rate-limit";
import { deletionBlocker, eraseAccount, loadDeletionFacts } from "@/lib/account-deletion";
import { ROSTER_MAX_ROWS } from "@/lib/roster-import";
import { readRowsByIds } from "@/lib/read-by-ids";

export const maxDuration = 300;

const UNDO_WINDOW_MS = 24 * 60 * 60 * 1000;

// Takes back a roster just added. A coach can already delete a client one at a time (/api/clients/delete); this is the same thing for the people one import made, with a tighter rule: only a person who has
// never signed in (claimed_at is empty), who is in this group, whose every group is one this coach coaches, and whose account passes the same checks as any deletion. Anyone else in the list is left
// where they are and reported. The coach's own records about a removed person (notes, programs) are kept, detached, never erased.
export async function POST(request: Request) {
  const supabase = await createServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });

  const limited = await rateLimitResponse("client-roster-undo", user.id, 10, 3600);
  if (limited) return limited;

  const raw = await request.json().catch(() => null);
  const body: { groupId?: unknown; profileIds?: unknown; spaces?: unknown } = raw && typeof raw === "object" ? raw : {};
  // Either one group and the people added to it (a roster), or each one-on-one client with their own space (a pasted list of one-on-one clients, Nov 20).
  const pairs: { groupId: string; profileId: string; ownSpace: boolean }[] = [];
  if (Array.isArray(body.spaces)) {
    for (const s of body.spaces.slice(0, ROSTER_MAX_ROWS) as unknown[]) {
      const item = s && typeof s === "object" ? (s as { groupId?: unknown; profileId?: unknown }) : {};
      if (typeof item.groupId === "string" && typeof item.profileId === "string") pairs.push({ groupId: item.groupId, profileId: item.profileId, ownSpace: true });
    }
  } else {
    const groupId = typeof body.groupId === "string" ? body.groupId : "";
    const ids: string[] = Array.isArray(body.profileIds) ? body.profileIds.filter((x: unknown): x is string => typeof x === "string").slice(0, ROSTER_MAX_ROWS) : [];
    for (const id of groupId ? ids : []) pairs.push({ groupId, profileId: id, ownSpace: false });
  }
  if (pairs.length === 0) return NextResponse.json({ error: "Missing the group or the people." }, { status: 400 });

  // The caller must coach every group named (checked as the caller, so row security decides).
  const groupIds = Array.from(new Set(pairs.map((p) => p.groupId)));
  const { data: coachRows } = await readRowsByIds(groupIds, (g) => (from, to) =>
    supabase.from("group_memberships").select("group_id, role").eq("profile_id", user.id).in("group_id", g).order("group_id").range(from, to)
  );
  const coached = new Set(((coachRows ?? []) as { group_id: string; role: string }[]).filter((r) => r.role === "coach").map((r) => r.group_id));
  if (groupIds.some((g) => !coached.has(g))) return NextResponse.json({ error: "Only the coach of this group can take back an import." }, { status: 403 });

  const db = createServiceRoleClient();
  const { data: myCoachGroups } = await db.from("group_memberships").select("group_id").eq("profile_id", user.id).eq("role", "coach");
  const mine = new Set((myCoachGroups ?? []).map((g: { group_id: string }) => g.group_id));

  const removed: string[] = [];
  const left: { profileId: string; reason: string }[] = [];
  for (const { groupId, profileId: id, ownSpace } of pairs) {
    if (id === user.id) {
      left.push({ profileId: id, reason: "That is you." });
      continue;
    }
    const [{ data: target }, { data: profile }, { data: theirGroups }] = await Promise.all([
      db.from("group_memberships").select("role").eq("group_id", groupId).eq("profile_id", id).maybeSingle(),
      db.from("profiles").select("claimed_at, created_at").eq("id", id).maybeSingle(),
      db.from("group_memberships").select("group_id").eq("profile_id", id),
    ]);
    if (target?.role !== "athlete" || !profile) {
      left.push({ profileId: id, reason: "Not a client in this group any more." });
      continue;
    }
    // The import does not record which accounts it made, so undo is limited to people added in the last day: an older client is never removed by this route.
    if (!profile.created_at || Date.now() - new Date(profile.created_at as string).getTime() > UNDO_WINDOW_MS) {
      left.push({ profileId: id, reason: "They were added more than a day ago, so they stay. Delete them one at a time if you need to." });
      continue;
    }
    if (profile.claimed_at) {
      left.push({ profileId: id, reason: "They have signed in since, so they stay." });
      continue;
    }
    if ((theirGroups ?? []).some((g: { group_id: string }) => !mine.has(g.group_id))) {
      left.push({ profileId: id, reason: "They also belong to a group you don't coach, so they stay." });
      continue;
    }
    const blocker = deletionBlocker(await loadDeletionFacts(db, id));
    if (blocker) {
      left.push({ profileId: id, reason: blocker });
      continue;
    }
    const result = await eraseAccount(db, id, { eraseHistory: false, deleteEmptyOneOnOneGroups: [] });
    if (!result.ok) {
      left.push({ profileId: id, reason: result.error });
      continue;
    }
    removed.push(id);
    // A one-on-one client's own space, made by the same import: removed with them when nothing else is in it (only the coach's seat, nothing filed in it).
    if (ownSpace) await removeImportedSpace(db, groupId, user.id);
  }

  return NextResponse.json({ removed, left });
}

// The space an import made for a one-on-one client, once that client is gone: deleted only if it is a one-on-one space this coach made in the last day, nobody else is in it, and nothing is filed in it
// (a program, a session or a post). Otherwise it is left as it is.
async function removeImportedSpace(db: ReturnType<typeof createServiceRoleClient>, groupId: string, coachId: string): Promise<void> {
  const { data: group } = await db.from("groups").select("created_by, created_at, group_kind").eq("id", groupId).maybeSingle();
  const g = group as { created_by?: string | null; created_at?: string | null; group_kind?: string | null } | null;
  if (!g || g.group_kind !== "one_on_one" || g.created_by !== coachId || !g.created_at || Date.now() - new Date(g.created_at).getTime() > UNDO_WINDOW_MS) return;
  const [{ data: members }, programs, sessions, posts] = await Promise.all([
    db.from("group_memberships").select("profile_id").eq("group_id", groupId),
    db.from("programs").select("id", { count: "exact", head: true }).eq("group_id", groupId),
    db.from("athlete_sessions").select("id", { count: "exact", head: true }).eq("group_id", groupId),
    db.from("posts").select("id", { count: "exact", head: true }).eq("group_id", groupId),
  ]);
  if ((members ?? []).some((m: { profile_id: string }) => m.profile_id !== coachId)) return;
  if ((programs.count ?? 0) + (sessions.count ?? 0) + (posts.count ?? 0) > 0) return;
  await db.from("group_memberships").delete().eq("group_id", groupId);
  await db.from("groups").delete().eq("id", groupId);
}
