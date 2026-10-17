import { pageAll } from "@/lib/page-all";
import { readByIds } from "@/lib/read-by-ids";

// "Your coaches": every space a person trains in as a client, with who coaches it. A client who trains with two coaches (two organizations) has no other way to see both, so this list is how they switch.
// Read across organizations as the signed-in person (row security shows them only their own groups and the coaches of those groups).
export interface YourCoachSpace {
  groupId: string;
  groupName: string;
  oneOnOne: boolean;
  organizationName: string;
  coachNames: string[];
}

export async function loadYourCoaches(supabase: any, userId: string): Promise<{ spaces: YourCoachSpace[]; failed: boolean }> {
  const mine = await pageAll(
    (from, to) =>
      supabase
        .from("group_memberships")
        .select("id, group_id, groups ( id, name, group_kind, organizations ( name ) )")
        .eq("profile_id", userId)
        .eq("role", "athlete")
        .order("id")
        .range(from, to),
    { maxPages: 5 }
  );
  const groupIds = mine.rows.map((r) => r.group_id as string);
  const coaches = await readByIds(groupIds, (ids) => (from, to) => supabase.from("group_memberships").select("id, group_id, profiles ( full_name )").in("group_id", ids).eq("role", "coach").order("id").range(from, to), { maxPages: 5 });
  const namesByGroup = new Map<string, string[]>();
  for (const c of coaches.rows) {
    const name = (c.profiles as { full_name?: string } | null)?.full_name;
    if (name) namesByGroup.set(c.group_id, [...(namesByGroup.get(c.group_id) ?? []), name]);
  }
  const spaces = mine.rows
    .map((r) => {
      const g = r.groups as { id: string; name: string; group_kind: string; organizations?: { name?: string } | null } | null;
      return g
        ? {
            groupId: g.id,
            groupName: g.name,
            oneOnOne: g.group_kind === "one_on_one",
            organizationName: g.organizations?.name ?? "",
            coachNames: (namesByGroup.get(g.id) ?? []).sort((a, b) => a.localeCompare(b)),
          }
        : null;
    })
    .filter((s): s is YourCoachSpace => s !== null)
    .sort((a, b) => a.organizationName.localeCompare(b.organizationName) || a.groupName.localeCompare(b.groupName));
  return { spaces, failed: mine.failed || coaches.failed };
}
