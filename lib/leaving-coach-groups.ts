import { readByIds } from "@/lib/read-by-ids";

// Of the groups a coach kept when they were marked leaving, the ones that are STILL the situation the export and the notice assume: still in that organization, and with no coach now. A group handed to
// another coach in the meantime, moved to another organization, or deleted, is left out: its records now belong to someone else's work, and its clients have a coach.
export async function groupsStillTheirs(db: any, organizationId: string, kept: string[]): Promise<{ ids: string[]; failed: boolean }> {
  if (kept.length === 0) return { ids: [], failed: false };
  const [groups, coaches] = await Promise.all([
    readByIds(kept, (ids) => (from, to) => db.from("groups").select("id").in("id", ids).eq("organization_id", organizationId).order("id").range(from, to), { maxPages: 100 }),
    readByIds(kept, (ids) => (from, to) => db.from("group_memberships").select("id, group_id").in("group_id", ids).eq("role", "coach").order("id").range(from, to), { maxPages: 100 }),
  ]);
  if (groups.failed || coaches.failed) return { ids: [], failed: true };
  const hasCoach = new Set(coaches.rows.map((c: { group_id: string }) => c.group_id));
  return { ids: groups.rows.map((g: { id: string }) => g.id).filter((id: string) => !hasCoach.has(id)), failed: false };
}
