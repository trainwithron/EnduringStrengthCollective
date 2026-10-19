import { pickAnchorGroup, type CoachedGroup } from "@/lib/coach-groups";

// The Spotlight hub on a phone acts on ONE group at a time (every tile is given a group). A coach who runs more than one organization needs to choose which one the tiles are about,
// without leaving the page. The choice is an organization; the group the tiles use is that organization's anchor group (the one the coach last worked in there, else its first team
// or social group), never a client's own one-on-one group.
export interface HubOrg {
  orgId: string;
  orgName: string;
  anchorGroupId: string;
}

// One entry per organization the coach coaches in, by name. Empty when there is only one (no choice to make).
export function hubOrgs(groups: CoachedGroup[], rememberedGroupId: string | null | undefined): HubOrg[] {
  const orgIds = [...new Set(groups.map((g) => g.orgId))];
  if (orgIds.length < 2) return [];
  return orgIds
    .map((orgId) => {
      const inOrg = groups.filter((g) => g.orgId === orgId);
      const anchor = pickAnchorGroup(inOrg, rememberedGroupId);
      return anchor ? { orgId, orgName: inOrg[0].orgName, anchorGroupId: anchor.id } : null;
    })
    .filter((o): o is HubOrg => !!o)
    .sort((a, b) => a.orgName.localeCompare(b.orgName));
}

// Which organization the hub starts on: the organization of the PAGE the coach is on (every request a page makes names that page's group, and the database refuses another organization's rows, so tiles that opened on a
// different organization from the page read blank: Oct 19 audit); only a page that belongs to no organization (the coach's own space) falls back to the one chosen with the switcher.
export function hubStartOrgId(groups: CoachedGroup[], rememberedGroupId: string | null | undefined, currentGroupId: string): string | null {
  const current = groups.find((g) => g.id === currentGroupId);
  if (current) return current.orgId;
  const remembered = rememberedGroupId ? groups.find((g) => g.id === rememberedGroupId && g.kind !== "one_on_one") : undefined;
  return remembered?.orgId ?? null;
}

// The organization the page itself belongs to, or null on a page of no organization (the coach's own space).
export function pageOrgId(groups: CoachedGroup[], currentGroupId: string): string | null {
  return groups.find((g) => g.id === currentGroupId)?.orgId ?? null;
}

/**
 * Which group the Spotlight hub's tiles act on when it opens. On a page that belongs to an organization it is that page's own organization (the page's group, or that organization's usual group when the page is a client's own space). On a page
 * that belongs to NO organization (the coach's own personal space, which is where a phone lands) the tiles must never act on that space: they act on the organization the coach chose, or on the only organization they have,
 * and with several organizations and none chosen the coach is asked to choose (needsChoice) instead of being shown their own programs as if they were the organization's.
 */
export function hubStartGroup(groups: CoachedGroup[], rememberedGroupId: string | null | undefined, currentGroupId: string): { groupId: string | null; needsChoice: boolean } {
  if (groups.length === 0) return { groupId: currentGroupId, needsChoice: false };
  const orgIds = [...new Set(groups.map((g) => g.orgId))];
  const remembered = rememberedGroupId ? groups.find((g) => g.id === rememberedGroupId && g.kind !== "one_on_one") : undefined;
  const current = groups.find((g) => g.id === currentGroupId);
  if (orgIds.length === 1 && current) return { groupId: currentGroupId, needsChoice: false };
  if (current) {
    // the page's own organization, never a remembered other one
    const anchor = pickAnchorGroup(groups.filter((g) => g.orgId === current.orgId), currentGroupId);
    return { groupId: anchor?.id ?? current.id, needsChoice: false };
  }
  if (remembered) {
    const anchor = pickAnchorGroup(groups.filter((g) => g.orgId === remembered.orgId), rememberedGroupId);
    return { groupId: anchor?.id ?? remembered.id, needsChoice: false };
  }
  // the page's group is in no organization (a personal space): one organization is the answer, several need a choice
  if (orgIds.length === 1) return { groupId: pickAnchorGroup(groups, rememberedGroupId)?.id ?? null, needsChoice: false };
  return { groupId: null, needsChoice: true };
}
