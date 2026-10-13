import { createServerClient } from "@/lib/supabase/server";
import { createServiceRoleClient } from "@/lib/supabase/service-role";
import { ReviewPromptCard } from "@/components/athlete/review-prompt-card";
import { athleteIsMinor } from "@/lib/youth-block";

// After 12 sessions an adult client is shown ONE small card asking for a short review. Once it has been shown (whatever they answer) it never comes back. It is never shown to a coach, to a person a
// coach is acting as, or to a client under 18 (an unknown date of birth counts as an adult, as everywhere else).
export const REVIEW_PROMPT_SESSIONS = 12;

export async function ReviewPromptSection({ groupId, athleteId }: { groupId: string; athleteId: string }) {
  const supabase = await createServerClient();
  const [{ data: shown }, { count }] = await Promise.all([
    supabase.from("review_prompts_shown").select("athlete_id").eq("athlete_id", athleteId).eq("group_id", groupId).maybeSingle(),
    supabase.from("workout_logs").select("id", { count: "exact", head: true }).eq("athlete_id", athleteId).eq("group_id", groupId),
  ]);
  if (shown || (count ?? 0) < REVIEW_PROMPT_SESSIONS) return null;
  // Never a client under 18: it invites a child to post a public review and to write a quote that could end up on the coach's page.
  if (await athleteIsMinor(supabase, athleteId)) return null;

  // The coach's first name, read on the server for this client's own group only.
  const db = createServiceRoleClient();
  const { data: coachRow } = await db.from("group_memberships").select("profile_id, profiles ( full_name )").eq("group_id", groupId).eq("role", "coach").limit(1).maybeSingle();
  if (!coachRow) return null;
  const coachName = ((coachRow.profiles as { full_name?: string | null } | null)?.full_name ?? "your coach").split(" ")[0];
  return <ReviewPromptCard groupId={groupId} athleteId={athleteId} coachId={coachRow.profile_id as string} coachName={coachName} />;
}
