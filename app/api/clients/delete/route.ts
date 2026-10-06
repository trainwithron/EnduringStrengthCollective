import { NextResponse } from "next/server";
import { createServerClient } from "@/lib/supabase/server";
import { createServiceRoleClient } from "@/lib/supabase/service-role";
import { rateLimitResponse } from "@/lib/rate-limit";
import { deletionBlocker, eraseAccount, loadDeletionFacts } from "@/lib/account-deletion";

// A coach deletes one of their clients completely: the account, memberships and the client's own data. Allowed only for a plain
// client account whose every group is one this coach coaches (someone who also belongs to another coach's group can only be
// removed from this one), with the client's name typed to confirm. The coach chooses whether logged workouts and notes go too;
// payment records are always kept, detached from the person. See lib/account-deletion.ts for exactly what is erased and kept.
export async function POST(request: Request) {
  const supabase = await createServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });

  const limited = await rateLimitResponse("client-delete", user.id, 20, 3600);
  if (limited) return limited;

  const body = await request.json().catch(() => ({}));
  const groupId = typeof body.groupId === "string" ? body.groupId : "";
  const athleteId = typeof body.athleteId === "string" ? body.athleteId : "";
  const confirmName = typeof body.confirmName === "string" ? body.confirmName.trim().toLowerCase() : "";
  const eraseHistory = body.eraseHistory === true;
  if (!groupId || !athleteId) return NextResponse.json({ error: "Missing client." }, { status: 400 });
  if (athleteId === user.id) return NextResponse.json({ error: "You can't delete your own account here." }, { status: 400 });

  // The caller must coach this group (checked as the caller, so row security decides), and the client must be an athlete in it.
  const { data: coachRow } = await supabase
    .from("group_memberships")
    .select("role")
    .eq("group_id", groupId)
    .eq("profile_id", user.id)
    .maybeSingle();
  if (coachRow?.role !== "coach") return NextResponse.json({ error: "Only the coach of this group can delete a client." }, { status: 403 });

  const db = createServiceRoleClient();
  const { data: target } = await db.from("group_memberships").select("role").eq("group_id", groupId).eq("profile_id", athleteId).maybeSingle();
  if (target?.role !== "athlete") return NextResponse.json({ error: "That person isn't a client in this group." }, { status: 404 });

  const { data: profile } = await db.from("profiles").select("full_name").eq("id", athleteId).maybeSingle();
  const name = (profile?.full_name ?? "").trim().toLowerCase();
  if (!name || confirmName !== name) return NextResponse.json({ error: "Type the client's name exactly to confirm." }, { status: 400 });

  // Every group this client is in must be one this coach coaches.
  const [{ data: theirGroups }, { data: myCoachGroups }] = await Promise.all([
    db.from("group_memberships").select("group_id, groups ( group_kind )").eq("profile_id", athleteId),
    db.from("group_memberships").select("group_id").eq("profile_id", user.id).eq("role", "coach"),
  ]);
  const mine = new Set((myCoachGroups ?? []).map((g: any) => g.group_id as string));
  if ((theirGroups ?? []).some((g: any) => !mine.has(g.group_id))) {
    return NextResponse.json(
      { error: "This person also belongs to groups you don't coach, so they can't be deleted here. Remove them from this group instead." },
      { status: 409 }
    );
  }

  const blocker = deletionBlocker(await loadDeletionFacts(db, athleteId));
  if (blocker) return NextResponse.json({ error: blocker }, { status: 409 });

  // One-on-one spaces that hold only this client go with them.
  const emptyOneOnOne: string[] = [];
  for (const g of theirGroups ?? []) {
    if ((g as any).groups?.group_kind !== "one_on_one") continue;
    const { count } = await db
      .from("group_memberships")
      .select("profile_id", { count: "exact", head: true })
      .eq("group_id", (g as any).group_id)
      .eq("role", "athlete")
      .neq("profile_id", athleteId);
    if ((count ?? 0) === 0) emptyOneOnOne.push((g as any).group_id);
  }

  const result = await eraseAccount(db, athleteId, { eraseHistory, deleteEmptyOneOnOneGroups: emptyOneOnOne });
  if (!result.ok) return NextResponse.json({ error: result.error }, { status: 502 });
  // The space is only removed when history was erased too; otherwise it stays (renamed) so the kept records still have a home.
  return NextResponse.json({ success: true, deletedGroupIds: eraseHistory ? emptyOneOnOne : [], warning: result.leftover ?? null });
}
