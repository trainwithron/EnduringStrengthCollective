import type { SupabaseClient } from "@supabase/supabase-js";

// "Build program" on a client's page opens that client's draft instead of making a new program every tap (Ron, Nov 24: four "Robyn's program" drafts; step 229 / 0473 added
// programs.for_client_id). The draft: this coach's, in the same group the new one would be made in, started for this client, still nobody's (no client on it), not hidden, not
// switched on (so nobody follows it) and never assigned (no client copy made from it). The newest one wins. Any read that fails (or the column not there yet, before the paste)
// means "none": a new program is made, as before.
export const DRAFT_LOOKUP_LIMIT = 10;

export async function findClientDraft(supabase: SupabaseClient, input: { coachId: string; groupId: string; clientId: string }): Promise<string | null> {
  const { data: drafts, error } = await supabase
    .from("programs")
    .select("id")
    .eq("created_by", input.coachId)
    .eq("group_id", input.groupId)
    .eq("for_client_id", input.clientId)
    .is("athlete_id", null)
    .is("archived_at", null)
    .eq("is_active", false)
    .order("created_at", { ascending: false })
    .limit(DRAFT_LOOKUP_LIMIT);
  if (error || !drafts || drafts.length === 0) return null;
  const ids = (drafts as { id: string }[]).map((d) => d.id);
  const { data: copies, error: copyError } = await supabase.from("programs").select("source_program_id").in("source_program_id", ids);
  if (copyError) return null;
  const assigned = new Set(((copies ?? []) as { source_program_id: string | null }[]).map((c) => c.source_program_id));
  return ids.find((id) => !assigned.has(id)) ?? null;
}

// The builder address for a client's draft, the same one a new program opens at, marked as reopened (the builder then offers "Start a new one instead").
export function draftAddress(groupId: string, programId: string, forClient: { id: string; groupId: string }, reopened: boolean): string {
  return `/groups/${groupId}/programs/${programId}?edit=1&forClient=${forClient.id}&clientGroup=${forClient.groupId}${reopened ? "&reopened=1" : ""}`;
}

// "Start a new one instead": Build program again, told to skip the draft.
export function startNewAddress(forClient: { id: string; groupId: string }): string {
  return `/groups/${forClient.groupId}/programs/new?athleteId=${forClient.id}&fresh=1`;
}
