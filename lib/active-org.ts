import { pickAnchorGroup, type CoachedGroup } from "@/lib/coach-groups";

// A coach can run several organizations (separate businesses). Home, and everything counted on it, belongs to ONE of them at a time: the active one. The active organization is
// the organization of the workspace group the coach last chose with the organization switcher (a cookie), else of their first team or social group. Another organization's groups
// and clients appear only after switching to it, or on the Organizations page. A client in two organizations counts in each of them, because each organization has its own
// membership for them.
export function activeOrgId(groups: Pick<CoachedGroup, "id" | "kind" | "orgId" | "name" | "orgName">[], rememberedGroupId: string | null | undefined): string | null {
  return pickAnchorGroup(groups as CoachedGroup[], rememberedGroupId)?.orgId ?? null;
}

// Keep only the groups that belong to the active organization. With no active organization (a coach with nothing to anchor on) nothing is kept back.
export function inActiveOrg<T extends { organization_id: string | null }>(groups: T[], orgId: string | null): T[] {
  return orgId ? groups.filter((g) => g.organization_id === orgId) : groups;
}
