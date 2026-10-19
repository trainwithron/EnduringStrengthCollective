// How many "request to train with me" requests are waiting for this coach in ALL their organizations (or one, when an organization is named), read through the database function (the coach cannot read the table itself). Never throws: when the count cannot be read the Requests link
// still shows, just without a number.
export async function pendingRequestCount(supabase: any, organizationId: string | null = null): Promise<number | null> {
  try {
    const { data, error } = await supabase.rpc("coach_client_request_count", { p_org: organizationId });
    if (error || typeof data !== "number") return null;
    return data;
  } catch {
    return null;
  }
}
