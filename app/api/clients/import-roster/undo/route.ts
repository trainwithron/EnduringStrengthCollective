import { NextResponse } from "next/server";
import { createServerClient } from "@/lib/supabase/server";
import { createServiceRoleClient } from "@/lib/supabase/service-role";
import { rateLimitResponse } from "@/lib/rate-limit";
import { deletionBlocker, eraseAccount, loadDeletionFacts } from "@/lib/account-deletion";
import { ROSTER_MAX_ROWS } from "@/lib/roster-import";

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
  const body: { groupId?: unknown; profileIds?: unknown } = raw && typeof raw === "object" ? raw : {};
  const groupId = typeof body.groupId === "string" ? body.groupId : "";
  const ids: string[] = Array.isArray(body.profileIds) ? body.profileIds.filter((x: unknown): x is string => typeof x === "string").slice(0, ROSTER_MAX_ROWS) : [];
  if (!groupId || ids.length === 0) return NextResponse.json({ error: "Missing the group or the people." }, { status: 400 });

  const { data: coachRow } = await supabase.from("group_memberships").select("role").eq("group_id", groupId).eq("profile_id", user.id).maybeSingle();
  if (coachRow?.role !== "coach") return NextResponse.json({ error: "Only the coach of this group can take back an import." }, { status: 403 });

  const db = createServiceRoleClient();
  const { data: myCoachGroups } = await db.from("group_memberships").select("group_id").eq("profile_id", user.id).eq("role", "coach");
  const mine = new Set((myCoachGroups ?? []).map((g: { group_id: string }) => g.group_id));

  const removed: string[] = [];
  const left: { profileId: string; reason: string }[] = [];
  for (const id of ids) {
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
    if (result.ok) removed.push(id);
    else left.push({ profileId: id, reason: result.error });
  }

  return NextResponse.json({ removed, left });
}
