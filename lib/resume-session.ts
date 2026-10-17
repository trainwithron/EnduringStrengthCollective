import type { SupabaseClient } from "@supabase/supabase-js";

// Puts a paused workout back to in progress and notes WHEN it was resumed (athlete_sessions.resumed_at, migration 0389), so the nightly job that pauses forgotten workouts counts from the resume, not from the
// original start. Before the column exists (the code live ahead of its database step) the same update is made without it, so resuming never breaks.
export async function resumeSession(supabase: SupabaseClient, sessionId: string): Promise<{ resumed: boolean }> {
  const first = await supabase.from("athlete_sessions").update({ status: "in_progress", resumed_at: new Date().toISOString() }).eq("id", sessionId).eq("status", "abandoned").select("id");
  if (first.error && /resumed_at/.test(String(first.error.message ?? ""))) {
    const second = await supabase.from("athlete_sessions").update({ status: "in_progress" }).eq("id", sessionId).eq("status", "abandoned").select("id");
    return { resumed: !second.error && (second.data ?? []).length > 0 };
  }
  return { resumed: !first.error && (first.data ?? []).length > 0 };
}
