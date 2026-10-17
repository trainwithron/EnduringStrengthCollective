// A coach who left an organization (or whose organization closed, or who was let go) but still has clients who are private from it is "leaving" (migration 0396): nothing has moved, and they choose what happens next
// inside seven days (lib/leaving-coach-policy.ts). Read as the coach; a database without the columns yet (or any failed read) shows nothing rather than breaking the page it sits on.
export interface MyDeparture {
  organizationId: string;
  organizationName: string;
  since: string;
  // Let go by the organization: no seven days, no starting an account.
  fired: boolean;
  // When coaching access ended (null while they still have their days).
  endedAt: string | null;
}

export async function loadMyDepartures(supabase: any, userId: string): Promise<MyDeparture[]> {
  try {
    const { data, error } = await supabase
      .from("organization_memberships")
      .select("organization_id, departing_since, fired_at, access_ended_at, organizations ( name, display_name )")
      .eq("profile_id", userId)
      .not("departing_since", "is", null);
    if (error || !Array.isArray(data)) return [];
    return data.map((r: any) => ({
      organizationId: r.organization_id as string,
      organizationName: (r.organizations?.display_name || r.organizations?.name || "your organization") as string,
      since: r.departing_since as string,
      fired: !!r.fired_at,
      endedAt: (r.access_ended_at as string | null) ?? null,
    }));
  } catch {
    return [];
  }
}
