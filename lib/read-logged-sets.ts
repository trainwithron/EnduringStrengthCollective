// A read of logged sets that includes the set type. The set_type column arrives with its database step; until it is there the same read is made without it (every set then counts as a working set), so a goal, a
// prior best or a suggestion never vanishes because of the order things were released in. `columns` must contain "set_type," for the fallback to remove it.
export async function readLoggedSets(supabase: any, columns: string, narrow: (q: any) => any): Promise<{ data: any[] | null }> {
  const first = await narrow(supabase.from("set_logs").select(columns));
  if (first.error && /set_type/.test(String(first.error.message ?? ""))) {
    return narrow(supabase.from("set_logs").select(columns.replace("set_type,", "")));
  }
  return first;
}
