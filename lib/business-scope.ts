import type { SupabaseClient } from "@supabase/supabase-js";
import { getCoachedGroups, groupsInOrgOf } from "@/lib/coach-groups";

// Which groups the Business page (and the MRR everywhere) counts. A coach sees their OWN groups in the open organization: their own clients, sessions and income. The owner or an admin of the
// organization sees the WHOLE organization: every group in it, every coach's sessions, every client (except a client the coach has marked private from the organization, which the database hides).
export interface BusinessScope {
  groupIds: string[];
  // True for an owner or admin: totals cover all coaches, so sessions are not limited to the viewer's own.
  organizationWide: boolean;
}

export async function loadBusinessScope(supabase: SupabaseClient, userId: string, groupId: string): Promise<BusinessScope> {
  const coached = groupsInOrgOf(await getCoachedGroups(supabase, userId), groupId);
  const orgId = coached[0]?.orgId ?? null;
  if (!orgId) return { groupIds: coached.map((g) => g.id), organizationWide: false };
  const { data: om } = await supabase.from("organization_memberships").select("role").eq("organization_id", orgId).eq("profile_id", userId).maybeSingle();
  const role = (om as { role?: string } | null)?.role;
  if (role !== "owner" && role !== "admin") return { groupIds: coached.map((g) => g.id), organizationWide: false };
  const { data: all } = await supabase.from("groups").select("id").eq("organization_id", orgId);
  const ids = ((all ?? []) as { id: string }[]).map((g) => g.id);
  return { groupIds: ids.length > 0 ? ids : coached.map((g) => g.id), organizationWide: true };
}
