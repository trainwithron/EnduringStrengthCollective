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

// Which organization the hub starts on: the one the organization switcher last chose (the same memory Home uses), else the organization of the page the coach is on.
export function hubStartOrgId(groups: CoachedGroup[], rememberedGroupId: string | null | undefined, currentGroupId: string): string | null {
  const remembered = rememberedGroupId ? groups.find((g) => g.id === rememberedGroupId && g.kind !== "one_on_one") : undefined;
  if (remembered) return remembered.orgId;
  return groups.find((g) => g.id === currentGroupId)?.orgId ?? null;
}
