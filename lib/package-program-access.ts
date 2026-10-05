import type { SupabaseClient } from "@supabase/supabase-js";

// A package can link a program that is copied to each buyer the first time they buy. That copy runs with the
// service role, so the program being copied must be checked here: it has to be a shared (not personal) program in
// a group this same coach coaches. Otherwise a coach could name any program id and have another coach's or
// another organization's program copied into their own client's account.
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
