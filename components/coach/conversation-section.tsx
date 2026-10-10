import type { SupabaseClient } from "@supabase/supabase-js";
import { CoachConversation } from "@/components/coach/coach-conversation";
import { inviteDue, type InviteState } from "@/lib/conversation-chapters";

// Server side of the one quiet invitation at the top of the coach's Programs page. It decides only whether to show it (see inviteDue: a few programs, the first 30 days after the third,
// questions on, shown for a week, one reminder at most). If the tables are not there yet it shows nothing.
export async function ConversationInviteSection({ supabase, coachId }: { supabase: SupabaseClient; coachId: string }) {
  const [{ data: settings, error }, { data: firstThree }] = await Promise.all([
    supabase.from("coach_learning_settings").select("questions_enabled, invite_state, invite_shown_at, invite_reminders").eq("coach_id", coachId).maybeSingle(),
    supabase.from("programs").select("created_at").eq("created_by", coachId).eq("ai_draft", false).order("created_at", { ascending: true }).limit(3),
  ]);
  if (error) return null;
  const s = settings as { questions_enabled?: boolean; invite_state?: InviteState; invite_shown_at?: string | null; invite_reminders?: number } | null;
  const rows = (firstThree ?? []) as { created_at: string }[];
  const kind = inviteDue({
    state: s?.invite_state ?? "new",
    reminders: s?.invite_reminders ?? 0,
    shownAt: s?.invite_shown_at ? new Date(s.invite_shown_at) : null,
    questionsEnabled: s?.questions_enabled !== false,
    programCount: rows.length,
    thirdProgramAt: rows.length >= 3 ? new Date(rows[2].created_at) : null,
    now: new Date(),
  });
  if (kind === "none") return null;
  return <CoachConversation coachId={coachId} invite={kind} />;
}
