import type { SupabaseClient } from "@supabase/supabase-js";

// The gym a QR page shows (an exercise's /scan/<id>, a machine's /scan/machine/<id>). A coach can be in several organizations (Ron owns three), so "the coach's organization" is not
// one row: asking for exactly one failed for him and every scan page said "this gym" with no logo (Nov 19). The organization comes from the code itself when it carries one (a printed
// exercise code has ?org=<the workspace it was printed in>; a machine has its own) and the coach is still a member of it; otherwise the coach's OLDEST membership, so an old code
// without one always shows the same, real gym.
export interface MembershipLite {
  organization_id: string;
  created_at: string;
  departing_since: string | null;
}

export function pickScanOrgId(memberships: MembershipLite[], requested: string | null | undefined): string | null {
  // A coach who is leaving an organization no longer speaks for it (the same rule as is_org_member).
  const current = memberships.filter((m) => !m.departing_since);
  if (requested && current.some((m) => m.organization_id === requested)) return requested;
  const pool = current.length > 0 ? current : memberships;
  const oldest = [...pool].sort((a, b) => a.created_at.localeCompare(b.created_at) || a.organization_id.localeCompare(b.organization_id))[0];
  return oldest?.organization_id ?? null;
}

export interface ScanOrg {
  id: string;
  name: string;
  logoUrl: string | null;
}

// Read with the server's key (the scan pages are public). `requested` is the code's own organization, used only when the coach is a member of it.
export async function loadScanOrg(serviceRole: SupabaseClient, coachId: string, requested: string | null | undefined): Promise<ScanOrg | null> {
  const { data: memberships } = await serviceRole.from("organization_memberships").select("organization_id, created_at, departing_since").eq("profile_id", coachId);
  const orgId = pickScanOrgId((memberships ?? []) as MembershipLite[], requested);
  if (!orgId) return null;
  const { data: org } = await serviceRole.from("organizations").select("id, display_name, name, logo_url").eq("id", orgId).maybeSingle();
  if (!org) return null;
  const o = org as { id: string; display_name: string | null; name: string | null; logo_url: string | null };
  return { id: o.id, name: o.display_name || o.name || "this gym", logoUrl: o.logo_url ?? null };
}

// The address a printed exercise code opens: with the workspace's organization when there is one.
export function exerciseScanPath(exerciseId: string, orgId: string | null | undefined): string {
  return orgId ? `/scan/${exerciseId}?org=${orgId}` : `/scan/${exerciseId}`;
}
