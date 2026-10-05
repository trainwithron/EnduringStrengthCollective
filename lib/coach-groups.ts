import type { SupabaseClient } from "@supabase/supabase-js";

// The coach's own world, scoped to ONE organization. Organizations are
// separate businesses (their own groups and one-on-one clients), so every
// coach-wide page, rail widget and list works over "the groups I coach in
// THIS org" — never every org at once, and never a single client's group.

export type GroupKind = "one_on_one" | "social" | "team";

export interface CoachedGroup {
  id: string;
  name: string;
  kind: GroupKind;
  orgId: string;
  orgName: string;
}

// Cookie remembering the last team/social group the coach worked in. It is
// the "anchor" Home and the rail use as a stable URL placeholder, and it is
// NEVER a one-on-one group (a client's own group would leak that client's
// identity into coach-wide pages).
export const LAST_WORKSPACE_GROUP_COOKIE = "last_workspace_group";

function normalizeKind(kind: string | null | undefined): GroupKind {
  return kind === "one_on_one" || kind === "social" ? kind : "team";
}

// Every group this person coaches (any org), with its org.
export async function getCoachedGroups(supabase: SupabaseClient, coachId: string): Promise<CoachedGroup[]> {
  const { data } = await supabase
    .from("group_memberships")
    .select("group_id, groups ( id, name, group_kind, organization_id, organizations ( name ) )")
    .eq("profile_id", coachId)
    .eq("role", "coach");

  const out: CoachedGroup[] = [];
  for (const row of (data ?? []) as any[]) {
    const g = row.groups;
    if (!g?.id || !g.organization_id) continue;
    out.push({
      id: g.id,
      name: g.name ?? "Group",
      kind: normalizeKind(g.group_kind),
      orgId: g.organization_id,
      orgName: g.organizations?.name ?? "Organization",
    });
  }
  return out.sort((a, b) => a.name.localeCompare(b.name));
}

// The coached groups in the same organization as `groupId` (the page's
// own group decides which org the coach is "in").
export function groupsInOrgOf(groups: CoachedGroup[], groupId: string): CoachedGroup[] {
  const orgId = groups.find((g) => g.id === groupId)?.orgId;
  return orgId ? groups.filter((g) => g.orgId === orgId) : [];
}

// Distinct orgs the coach coaches in.
export function coachedOrgs(groups: CoachedGroup[]): { id: string; name: string }[] {
  const byId = new Map<string, string>();
  for (const g of groups) byId.set(g.orgId, g.orgName);
  return [...byId.entries()].map(([id, name]) => ({ id, name })).sort((a, b) => a.name.localeCompare(b.name));
}

// A stable group to anchor coach-wide URLs and the Home shell on: the
// remembered workspace group if it is still one of theirs and not a
// one-on-one group, else their first team/social group, else (a coach with
// only one-on-one clients) any group — safe because coach-wide pages never
// display the anchor group's identity.
export function pickAnchorGroup(
  groups: CoachedGroup[],
  rememberedGroupId: string | null | undefined,
  preferredOrgId?: string | null
): CoachedGroup | null {
  const pool = preferredOrgId ? groups.filter((g) => g.orgId === preferredOrgId) : groups;
  const candidates = pool.length > 0 ? pool : groups;
  const remembered = candidates.find((g) => g.id === rememberedGroupId && g.kind !== "one_on_one");
  if (remembered) return remembered;
  return candidates.find((g) => g.kind !== "one_on_one") ?? candidates[0] ?? null;
}
