import type { SupabaseClient } from "@supabase/supabase-js";
import { getCoachedGroups, groupsInOrgOf, type GroupKind } from "@/lib/coach-groups";

// Every client a coach has, across ALL their groups in the organization the page is in. A one-on-one client lives in their own
// group, so a list built from just the group the coach is standing in shows one person (or, in a team group, only the team).
// A client in more than one group is listed once, under their one-on-one space when they have one, because sessions and balances
// are kept per group and that is where the coach books them.

export interface CoachClient {
  id: string;
  fullName: string;
  avatarUrl: string | null;
  groupId: string;
  groupKind: GroupKind;
}

const KIND_RANK: Record<GroupKind, number> = { one_on_one: 0, team: 1, social: 2 };

export function dedupeClients(rows: CoachClient[]): CoachClient[] {
  const best = new Map<string, CoachClient>();
  for (const r of rows) {
    const current = best.get(r.id);
    if (!current || KIND_RANK[r.groupKind] < KIND_RANK[current.groupKind]) best.set(r.id, r);
  }
  return [...best.values()].sort((a, b) => a.fullName.localeCompare(b.fullName));
}

export async function getCoachClients(supabase: SupabaseClient, coachId: string, anchorGroupId: string): Promise<CoachClient[]> {
  const groups = groupsInOrgOf(await getCoachedGroups(supabase, coachId), anchorGroupId);
  if (groups.length === 0) return [];
  const kindByGroup = new Map(groups.map((g) => [g.id, g.kind]));
  const { data } = await supabase
    .from("group_memberships")
    .select("profile_id, group_id, profiles ( full_name, avatar_url )")
    .in("group_id", groups.map((g) => g.id))
    .eq("role", "athlete");
  const rows: CoachClient[] = ((data ?? []) as any[]).map((m) => ({
    id: m.profile_id as string,
    fullName: (m.profiles?.full_name ?? "Unknown") as string,
    avatarUrl: (m.profiles?.avatar_url ?? null) as string | null,
    groupId: m.group_id as string,
    groupKind: kindByGroup.get(m.group_id) ?? "team",
  }));
  return dedupeClients(rows);
}
