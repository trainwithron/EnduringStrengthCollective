import type { SupabaseClient } from "@supabase/supabase-js";
import { activeOrgId, clientCountsByOrg } from "@/lib/active-org";
import { getCoachedGroups, groupsInOrgOf, LAST_WORKSPACE_GROUP_COOKIE, type CoachedGroup } from "@/lib/coach-groups";

// For code that runs in the browser (finders, pickers, rail widgets): the coached groups of the organization the coach is IN. That is the organization of the page's group; on a page with no
// group (Home) it is the organization they chose (the remembered workspace), and only with nothing chosen the one the rule in lib/active-org.ts picks. Never every organization at once.
export async function activeOrgGroupsFor(supabase: SupabaseClient, coachId: string, anchorGroupId: string | null | undefined): Promise<CoachedGroup[]> {
  const all = await getCoachedGroups(supabase, coachId);
  if (all.length === 0) return [];
  if (anchorGroupId) {
    const inOrg = groupsInOrgOf(all, anchorGroupId);
    if (inOrg.length > 0) return inOrg;
  }
  const remembered = readRememberedWorkspaceGroup();
  const rememberedValid = !!remembered && all.some((g) => g.id === remembered && g.kind !== "one_on_one");
  const needsCounts = !rememberedValid && new Set(all.map((g) => g.orgId)).size > 1;
  const counts = needsCounts ? await clientCountsByOrg(supabase, all) : {};
  const orgId = activeOrgId(all, remembered, counts);
  return orgId ? all.filter((g) => g.orgId === orgId) : [];
}

function readRememberedWorkspaceGroup(): string | null {
  if (typeof document === "undefined") return null;
  const raw = document.cookie.split("; ").find((c) => c.startsWith(`${LAST_WORKSPACE_GROUP_COOKIE}=`))?.split("=")[1];
  if (!raw) return null;
  try {
    return decodeURIComponent(raw);
  } catch {
    return raw;
  }
}
