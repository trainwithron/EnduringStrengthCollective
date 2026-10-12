import { cookies } from "next/headers";
import type { SupabaseClient } from "@supabase/supabase-js";
import { activeOrgId, clientCountsByOrg } from "@/lib/active-org";
import { getCoachedGroups, LAST_WORKSPACE_GROUP_COOKIE, pickAnchorGroup, type CoachedGroup } from "@/lib/coach-groups";

// The group a coach-level page (Programs, Calendar, Clients, Group calendar, Messages...) stands on, and so the organization it shows. It follows the organization the coach CHOSE:
// the remembered workspace group (written by the organization switcher, and by visiting any team or social group), then, with nothing remembered, the organization with the most
// clients (lib/active-org.ts). It used to be "the first team group by name across ALL organizations", which sent a coach who had picked a smaller organization back to the biggest
// one on every click of Programs, Calendar or Clients, and changed the colors with it.
export interface ActiveAnchor {
  anchor: CoachedGroup;
  orgId: string;
  groups: CoachedGroup[];
}

// Pure, so it can be tested without cookies.
export function chooseActiveAnchor(groups: CoachedGroup[], rememberedGroupId: string | null | undefined, clientsByOrg: Record<string, number> = {}): { anchor: CoachedGroup; orgId: string } | null {
  if (groups.length === 0) return null;
  const orgId = activeOrgId(groups, rememberedGroupId, clientsByOrg);
  const anchor = pickAnchorGroup(groups, rememberedGroupId, orgId);
  return anchor ? { anchor, orgId: anchor.orgId } : null;
}

export async function getActiveAnchor(supabase: SupabaseClient, coachId: string): Promise<ActiveAnchor | null> {
  const groups = await getCoachedGroups(supabase, coachId);
  if (groups.length === 0) return null;
  const remembered = decodeCookie((await cookies()).get(LAST_WORKSPACE_GROUP_COOKIE)?.value);
  // The client counts are only needed to break the tie when nothing valid is remembered.
  const rememberedValid = !!remembered && groups.some((g) => g.id === remembered && g.kind !== "one_on_one");
  const counts = rememberedValid || new Set(groups.map((g) => g.orgId)).size < 2 ? {} : await clientCountsByOrg(supabase, groups);
  const chosen = chooseActiveAnchor(groups, remembered, counts);
  return chosen ? { ...chosen, groups } : null;
}

function decodeCookie(raw: string | undefined): string | null {
  if (!raw) return null;
  try {
    return decodeURIComponent(raw);
  } catch {
    return raw;
  }
}
