import type { SupabaseClient } from "@supabase/supabase-js";
import { pageAll } from "@/lib/page-all";
import { pickAnchorGroup, type CoachedGroup } from "@/lib/coach-groups";

// A coach can run several organizations (separate businesses). Home, and everything counted on it, belongs to ONE of them at a time: the active one.
//   1. The organization they last used: the organization switcher remembers the workspace group they chose (a cookie), and visiting a group does too.
//   2. When nothing is remembered (a new browser, or that group is gone): the organization with the MOST clients. Owning all of them does not tell them apart.
//   3. Ties, or no clients anywhere: the first team or social group by name.
// Another organization's groups and clients appear only after switching to it, or on the Organizations page. A client in two organizations counts in each of them, because each
// organization has its own membership for them.
type GroupLike = Pick<CoachedGroup, "id" | "kind" | "orgId" | "name" | "orgName">;

// The organization of the remembered workspace group, if it is still one of this coach's (and not a client's own one-on-one group).
export function rememberedOrgId(groups: GroupLike[], rememberedGroupId: string | null | undefined): string | null {
  if (!rememberedGroupId) return null;
  return groups.find((g) => g.id === rememberedGroupId && g.kind !== "one_on_one")?.orgId ?? null;
}

export function activeOrgId(groups: GroupLike[], rememberedGroupId: string | null | undefined, clientsByOrg: Record<string, number> = {}): string | null {
  const remembered = rememberedOrgId(groups, rememberedGroupId);
  if (remembered) return remembered;
  const orgIds = [...new Set(groups.map((g) => g.orgId))];
  const most = Math.max(0, ...orgIds.map((id) => clientsByOrg[id] ?? 0));
  const pool = most > 0 ? groups.filter((g) => (clientsByOrg[g.orgId] ?? 0) === most) : groups;
  return pickAnchorGroup(pool as CoachedGroup[], null)?.orgId ?? null;
}

// How many clients each of the coach's organizations has (athlete memberships in the groups they coach), read a page at a time. A failed read gives no counts, which falls through to
// the name order rather than guessing.
export async function clientCountsByOrg(supabase: SupabaseClient, groups: GroupLike[]): Promise<Record<string, number>> {
  const orgOf = new Map(groups.map((g) => [g.id, g.orgId]));
  const ids = [...orgOf.keys()];
  if (ids.length === 0) return {};
  const { rows, failed } = await pageAll((from, to) =>
    supabase.from("group_memberships").select("group_id, profile_id").in("group_id", ids).eq("role", "athlete").order("group_id", { ascending: true }).order("profile_id", { ascending: true }).range(from, to)
  );
  if (failed) return {};
  const seen = new Set<string>();
  const out: Record<string, number> = {};
  for (const r of rows as { group_id: string; profile_id: string }[]) {
    const org = orgOf.get(r.group_id);
    if (!org) continue;
    // A client in two groups of the same organization counts once for it.
    const key = `${org}:${r.profile_id}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out[org] = (out[org] ?? 0) + 1;
  }
  return out;
}

// Keep only the groups that belong to the active organization. With no active organization (a coach with nothing to anchor on) nothing is kept back.
export function inActiveOrg<T extends { organization_id: string | null }>(groups: T[], orgId: string | null): T[] {
  return orgId ? groups.filter((g) => g.organization_id === orgId) : groups;
}
