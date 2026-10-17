// A coach who left an organization (or whose organization closed) but still coaches clients who are private from it is "leaving" (migration 0396): nothing has moved, and they choose what happens next.
// Read as the coach; a database without the column yet (or any failed read) shows nothing rather than breaking the page it sits on.
export interface MyDeparture {
  organizationId: string;
  organizationName: string;
  since: string;
}

export async function loadMyDepartures(supabase: any, userId: string): Promise<MyDeparture[]> {
  try {
    const { data, error } = await supabase
      .from("organization_memberships")
      .select("organization_id, departing_since, organizations ( name, display_name )")
      .eq("profile_id", userId)
      .not("departing_since", "is", null);
    if (error || !Array.isArray(data)) return [];
    return data.map((r: any) => ({
      organizationId: r.organization_id as string,
      organizationName: (r.organizations?.display_name || r.organizations?.name || "your organization") as string,
      since: r.departing_since as string,
    }));
  } catch {
    return [];
  }
}
