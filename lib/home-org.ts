import type { SupabaseClient } from "@supabase/supabase-js";
import type { NextResponse } from "next/server";
import { ACTIVE_ORG_COOKIE } from "@/lib/active-org";
import { LAST_WORKSPACE_GROUP_COOKIE } from "@/lib/workspace-header";

// A coach's HOME organization (Ron, Oct 21): every fresh open of the app (/coach-landing) starts there. It is the organization they OWN (the oldest one when they own several); a coach who owns none starts in
// the one they joined first. No setting, no screen. Only an organization they coach a group in counts (their other memberships have nothing to open). A switch made in Spotlight sticks while they work, until
// the next fresh open.
export interface OrgMembershipRow {
  organization_id: string;
  role: string | null;
  created_at: string | null;
}

/** Pure: the home organization among the ones the coach coaches in, or null when there is none. */
export function homeOrgId(coachedOrgIds: readonly string[], memberships: readonly OrgMembershipRow[]): string | null {
  if (coachedOrgIds.length === 0) return null;
  const coached = new Set(coachedOrgIds);
  const rows = memberships.filter((m) => coached.has(m.organization_id)).sort((a, b) => (a.created_at ?? "").localeCompare(b.created_at ?? ""));
  return rows.find((m) => m.role === "owner")?.organization_id ?? rows[0]?.organization_id ?? coachedOrgIds[0];
}

/** The coach's own organization memberships. A failed read gives null, and the caller keeps the organization already chosen. */
export async function readHomeOrgId(supabase: SupabaseClient, userId: string, coachedOrgIds: readonly string[]): Promise<string | null> {
  if (coachedOrgIds.length === 0) return null;
  const { data, error } = await supabase.from("organization_memberships").select("organization_id, role, created_at").eq("profile_id", userId);
  if (error) return null;
  return homeOrgId(coachedOrgIds, (data ?? []) as OrgMembershipRow[]);
}

/** The same two cookies the organization chooser sets (app/choose-organization/select/route.ts): the organization, and the group of it to stand on. */
export function setActiveOrgCookies(response: NextResponse, orgId: string, groupId: string): void {
  const options = { httpOnly: false, sameSite: "lax" as const, secure: process.env.NODE_ENV === "production", path: "/", maxAge: 60 * 60 * 24 * 90 };
  response.cookies.set(ACTIVE_ORG_COOKIE, encodeURIComponent(orgId), options);
  response.cookies.set(LAST_WORKSPACE_GROUP_COOKIE, encodeURIComponent(groupId), options);
}
