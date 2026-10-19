import { readByIds } from "@/lib/read-by-ids";
import type { SupabaseClient } from "@supabase/supabase-js";
import { pickAnchorGroup, type CoachedGroup } from "@/lib/coach-groups";

// A coach can run several organizations (separate businesses). Home, and everything counted on it, belongs to ONE of them at a time: the active one.
//   1. The organization they last used: the organization switcher remembers the workspace group they chose (a cookie), and visiting a group does too.
//   2. When nothing is remembered (a new browser, or that group is gone): the organization with the MOST clients. Owning all of them does not tell them apart.
//   3. Ties, or no clients anywhere: the first team or social group by name.
// Another organization's groups and clients appear only after switching to it, or on the Organizations page. A client in two organizations counts in each of them, because each
// organization has its own membership for them.
type GroupLike = Pick<CoachedGroup, "id" | "kind" | "orgId" | "name" | "orgName">;

// THE active organization lives in its OWN cookie, set only by a deliberate choice (the organization chooser, the organization switcher, the header menu, the phone hub). It used to be worked out from "the last group
// opened", which opening ANY group page (even a prefetched link) rewrote, so a coach who had chosen one organization found themselves in another. Opening a group no longer changes the organization: the chosen one stays
// until the coach picks another. With nothing valid chosen and more than one organization, the page sends them to the chooser; it never picks one for them.
export const ACTIVE_ORG_COOKIE = "active_org";

/**
 * The group to treat as "the remembered workspace" for the chosen organization: the last group opened if it belongs to the chosen organization, else that organization's usual group. Null when no organization was chosen
 * or the chosen one is not (any more) one of this coach's, so callers fall back to the chooser (several organizations) or the only one.
 */
export function rememberedGroupForActiveOrg(groups: GroupLike[], activeOrgCookie: string | null | undefined, lastWorkspaceGroupId: string | null | undefined): string | null {
  if (!activeOrgCookie) return null;
  const inOrg = groups.filter((g) => g.orgId === activeOrgCookie && g.kind !== "one_on_one");
  if (inOrg.length === 0) return null;
  if (lastWorkspaceGroupId && inOrg.some((g) => g.id === lastWorkspaceGroupId)) return lastWorkspaceGroupId;
  return pickAnchorGroup(inOrg as CoachedGroup[], null, activeOrgCookie)?.id ?? null;
}

export function decodeCookieValue(raw: string | null | undefined): string | null {
  if (!raw) return null;
  try {
    return decodeURIComponent(raw);
  } catch {
    return raw;
  }
}

/** For code running in the browser. */
export function readBrowserCookie(name: string): string | null {
  if (typeof document === "undefined") return null;
  return decodeCookieValue(document.cookie.split("; ").find((c) => c.startsWith(`${name}=`))?.split("=")[1] ?? null);
}

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
  const { rows, failed } = await readByIds(ids, (g) => (from, to) =>
    supabase.from("group_memberships").select("group_id, profile_id").in("group_id", g).eq("role", "athlete").order("group_id", { ascending: true }).order("profile_id", { ascending: true }).range(from, to)
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
