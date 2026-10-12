import type { SupabaseClient } from "@supabase/supabase-js";

// A coach's Pro Shop links, referral partners, challenges, calendar entries, session types and discovery prospects belong to an organization (migration 0350). The page's group decides which one:
// the organization of the group being viewed. These two helpers are how a page reads and files such a row for that organization only.
export async function orgIdOfGroup(supabase: SupabaseClient, groupId: string): Promise<string | null> {
  const { data } = await supabase.from("groups").select("organization_id").eq("id", groupId).maybeSingle();
  return ((data as { organization_id?: string | null } | null)?.organization_id ?? null) as string | null;
}

// Limits a query on one of those tables to the organization. A page whose group has no organization (it should not happen) sees only rows with none.
// (The query type is passed through untouched; only the filter is added.)
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function inOrg<Q>(query: Q, organizationId: string | null): Q {
  const q = query as any;
  return (organizationId ? q.eq("organization_id", organizationId) : q.is("organization_id", null)) as Q;
}
