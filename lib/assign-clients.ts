import type { SupabaseClient } from "@supabase/supabase-js";
import { getCoachedGroups, type GroupKind } from "@/lib/coach-groups";

// Who a coach can give a program to: EVERY client of theirs, in any group they coach (a program lives in one group, but the client it is for may be in another), each once. The copy
// is made in the CLIENT'S OWN space, never assumed to be the program's own group.

export interface AssignClient {
  id: string;
  fullName: string;
  // The group the copy is created in.
  destinationGroupId: string;
  // A quiet hint, only when it helps (the group they are in, if it is not their own one-on-one space).
  hint: string | null;
}

export interface Membership {
  groupId: string;
  kind: GroupKind;
}

// Where a client's copy goes: their one-on-one space if they have one; otherwise the program's own group if they are in it; otherwise the first group of theirs that the coach coaches.
export function pickDestination(memberships: Membership[], programGroupId: string): string | null {
  if (memberships.length === 0) return null;
  const oneOnOne = memberships.find((m) => m.kind === "one_on_one");
  if (oneOnOne) return oneOnOne.groupId;
  const same = memberships.find((m) => m.groupId === programGroupId);
  return (same ?? memberships[0]).groupId;
}

export async function loadAssignableClients(supabase: SupabaseClient, coachId: string, programGroupId: string): Promise<AssignClient[]> {
  const groups = await getCoachedGroups(supabase, coachId);
  if (groups.length === 0) return [];
  const byId = new Map(groups.map((g) => [g.id, g]));
  const { data } = await supabase
    .from("group_memberships")
    .select("profile_id, group_id, profiles ( full_name )")
    .in("group_id", groups.map((g) => g.id))
    .eq("role", "athlete");
  const people = new Map<string, { fullName: string; memberships: Membership[] }>();
  for (const row of (data ?? []) as any[]) {
    const g = byId.get(row.group_id);
    if (!g || !row.profile_id) continue;
    const entry = people.get(row.profile_id) ?? { fullName: (row.profiles?.full_name ?? "Unknown") as string, memberships: [] };
    entry.memberships.push({ groupId: row.group_id as string, kind: g.kind });
    people.set(row.profile_id, entry);
  }
  const out: AssignClient[] = [];
  for (const [id, p] of people) {
    const destinationGroupId = pickDestination(p.memberships, programGroupId);
    if (!destinationGroupId) continue;
    const g = byId.get(destinationGroupId);
    out.push({ id, fullName: p.fullName, destinationGroupId, hint: g && g.kind !== "one_on_one" ? g.name : null });
  }
  return out.sort((a, b) => a.fullName.localeCompare(b.fullName));
}
