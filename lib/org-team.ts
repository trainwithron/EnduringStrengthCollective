import { pageAll } from "@/lib/page-all";
import { readByIds } from "@/lib/read-by-ids";

// What the Team page shows beside each member: how many clients they coach in this organization (clients private from the organization are not visible to an owner or admin, so they are not counted),
// and the invitations that have not been answered. Read as the signed-in person, over the organization's groups in groups of ids and pages.
export interface TeamInfo {
  clientCounts: Record<string, number>;
  // Members who alone coach at least one group that has clients: the ones whose removal needs somebody to take over.
  soleCoachOfClients: Record<string, number>;
  invites: { id: string; name: string; role: string; expiresAt: string }[];
  failed: boolean;
}

export async function loadTeamInfo(supabase: any, orgId: string): Promise<TeamInfo> {
  const groups = await pageAll((from, to) => supabase.from("groups").select("id").eq("organization_id", orgId).order("id").range(from, to), { maxPages: 100 });
  const groupIds = groups.rows.map((g) => g.id as string);
  const [seats, athletes, inviteRead] = await Promise.all([
    readByIds(groupIds, (ids) => (from, to) => supabase.from("group_memberships").select("id, group_id, profile_id").in("group_id", ids).eq("role", "coach").order("id").range(from, to), { maxPages: 100 }),
    readByIds(groupIds, (ids) => (from, to) => supabase.from("group_memberships").select("id, group_id, profile_id, private_from_org").in("group_id", ids).eq("role", "athlete").order("id").range(from, to), { maxPages: 100 }),
    supabase
      .from("organization_invites")
      .select("id, role, expires_at, profiles!organization_invites_invited_profile_id_fkey ( full_name )")
      .eq("organization_id", orgId)
      .is("answered_at", null)
      .order("created_at", { ascending: false }),
  ]);

  const clientsByGroup = new Map<string, Set<string>>();
  // Clients who keep their records private from the organization leave WITH their coach, so they never need somebody to take over: they are left out of the "needs a new coach" count.
  const handOverClientsByGroup = new Map<string, Set<string>>();
  for (const a of athletes.rows) {
    const set = clientsByGroup.get(a.group_id) ?? new Set<string>();
    set.add(a.profile_id);
    clientsByGroup.set(a.group_id, set);
    if (!a.private_from_org) {
      const needs = handOverClientsByGroup.get(a.group_id) ?? new Set<string>();
      needs.add(a.profile_id);
      handOverClientsByGroup.set(a.group_id, needs);
    }
  }
  const coachesByGroup = new Map<string, string[]>();
  for (const s of seats.rows) coachesByGroup.set(s.group_id, [...(coachesByGroup.get(s.group_id) ?? []), s.profile_id]);

  const mine = new Map<string, Set<string>>();
  const sole: Record<string, number> = {};
  for (const [groupId, coaches] of coachesByGroup) {
    const clients = clientsByGroup.get(groupId);
    for (const c of coaches) {
      const set = mine.get(c) ?? new Set<string>();
      for (const k of clients ?? []) set.add(k);
      mine.set(c, set);
    }
    const needsNewCoach = handOverClientsByGroup.get(groupId);
    // A group that holds any client private from the organization moves with its coach as a whole, so it never needs a hand-over either.
    const holdsPrivate = (clients?.size ?? 0) > (needsNewCoach?.size ?? 0);
    if (coaches.length === 1 && !holdsPrivate && (needsNewCoach?.size ?? 0) > 0) sole[coaches[0]] = (sole[coaches[0]] ?? 0) + (needsNewCoach?.size ?? 0);
  }
  const clientCounts: Record<string, number> = {};
  for (const [coach, set] of mine) clientCounts[coach] = set.size;

  const invites = ((inviteRead.data ?? []) as any[]).map((i) => ({
    id: i.id as string,
    name: (i.profiles as { full_name?: string } | null)?.full_name ?? "Invited coach",
    role: i.role as string,
    expiresAt: i.expires_at as string,
  }));
  return { clientCounts, soleCoachOfClients: sole, invites, failed: groups.failed || seats.failed || athletes.failed || !!inviteRead.error };
}
