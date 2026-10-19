import { cookies } from "next/headers";
import type { SupabaseClient } from "@supabase/supabase-js";
import { getCoachedGroups, LAST_WORKSPACE_GROUP_COOKIE, pickAnchorGroup, type CoachedGroup } from "@/lib/coach-groups";
import { ACTIVE_ORG_COOKIE, decodeCookieValue, rememberedGroupForActiveOrg } from "@/lib/active-org";

// The group a coach-level page (Programs, Calendar, Clients, Group calendar, Messages...) stands on, and so the organization it shows. It follows the organization the coach CHOSE: the remembered
// workspace group (written by the organization switcher, by the organization chooser, and by visiting any team or social group). With nothing valid remembered and more than one organization, the
// page does NOT guess (it used to take "the organization with the most clients", or "the first group by name across all organizations", which sent a coach who had picked a smaller organization
// back to the biggest one on every click): it sends them to the organization chooser (/choose-organization). A coach with one organization needs no choice.
export interface ActiveAnchor {
  anchor: CoachedGroup;
  orgId: string;
  groups: CoachedGroup[];
  // More than one organization and nothing valid remembered: the page must send the coach to the chooser.
  needsChoice: boolean;
}

export const CHOOSE_ORGANIZATION_PATH = "/choose-organization";

// Pure, so it can be tested without cookies.
export function chooseActiveAnchor(groups: CoachedGroup[], rememberedGroupId: string | null | undefined): { anchor: CoachedGroup; orgId: string; needsChoice: boolean } | null {
  if (groups.length === 0) return null;
  const remembered = rememberedGroupId ? groups.find((g) => g.id === rememberedGroupId) : undefined;
  const orgIds = [...new Set(groups.map((g) => g.orgId))];
  if (remembered) {
    const anchor = pickAnchorGroup(groups, remembered.id, remembered.orgId) ?? remembered;
    return { anchor, orgId: remembered.orgId, needsChoice: false };
  }
  // Nothing valid remembered. With one organization there is nothing to choose; with several the coach chooses (the anchor below is only a placeholder for the redirect).
  const orgId = orgIds[0];
  const anchor = pickAnchorGroup(groups, null, orgId) ?? groups[0];
  return { anchor, orgId: anchor.orgId, needsChoice: orgIds.length > 1 };
}

export async function getActiveAnchor(supabase: SupabaseClient, coachId: string): Promise<ActiveAnchor | null> {
  const groups = await getCoachedGroups(supabase, coachId);
  if (groups.length === 0) return null;
  const jar = await cookies();
  // The organization comes from the dedicated choice (ACTIVE_ORG_COOKIE), never from the last group opened; the last group only picks WHICH group of that organization.
  const remembered = rememberedGroupForActiveOrg(groups, decodeCookieValue(jar.get(ACTIVE_ORG_COOKIE)?.value), decodeCookieValue(jar.get(LAST_WORKSPACE_GROUP_COOKIE)?.value));
  const chosen = chooseActiveAnchor(groups, remembered);
  return chosen ? { ...chosen, groups } : null;
}
