import type { SupabaseClient } from "@supabase/supabase-js";

// A package can link a program that is copied to each buyer the first time they buy. That copy runs with the
// service role, so the program being copied must be checked here: it has to be a shared (not personal) program in
// a group this same coach coaches. Otherwise a coach could name any program id and have another coach's or
// another organization's program copied into their own client's account.
// True when this client already has their own copy of that program in that group (a copy made from it, removed-from-profile copies included). Used so a retried payment event or a
// repeated assignment never hands the same client the same program twice.
export async function athleteHasCopyOfProgram(
  supabase: SupabaseClient,
  { sourceProgramId, athleteId, groupId }: { sourceProgramId: string; athleteId: string; groupId: string }
): Promise<boolean> {
  const { data } = await supabase
    .from("programs")
    .select("id")
    .eq("source_program_id", sourceProgramId)
    .eq("athlete_id", athleteId)
    .eq("group_id", groupId)
    .limit(1);
  return (data ?? []).length > 0;
}

export async function programBelongsToCoach(
  supabase: SupabaseClient,
  coachId: string,
  programId: string
): Promise<boolean> {
  const { data: program } = await supabase
    .from("programs")
    .select("group_id, athlete_id")
    .eq("id", programId)
    .maybeSingle();
  if (!program || program.athlete_id) return false;
  const { data: membership } = await supabase
    .from("group_memberships")
    .select("role")
    .eq("group_id", program.group_id)
    .eq("profile_id", coachId)
    .eq("role", "coach")
    .maybeSingle();
  return !!membership;
}
