import type { SupabaseClient } from "@supabase/supabase-js";

// What the post-workout card is built from. Normally that is the workout's feed post. But a client who keeps their workouts off the group feed (Settings:
// sharing to the group feed turned off) has no post, and a one-on-one client's workouts have no feed to appear in; both still get the card and the Share
// picture at the end of a workout (Ron, Oct 6). So the same link also works with the id of the workout log: the card is then built straight from the
// log, in full, as a post-shaped object, and everything downstream (top lifts, PRs, streak, the image) is the same code.
//
// The link is as private as before: it is an unguessable id, and only what the card shows is read, with the server's own access.
// `logAllowed` is true only when the link carries a valid signature (lib/share-token.ts): without it only a real feed post opens, so a card the client chose not
// to post cannot be opened by someone who merely knows the workout log's id.
export async function loadSharedSource(supabase: SupabaseClient, id: string, logAllowed = true): Promise<{ post: any; workoutLog: any } | null> {
  const { data: post } = await supabase
    .from("posts")
    .select(
      `
      id, post_type, created_at, group_id, broadcast_level, author_id, shared_exercise_names,
      profiles!posts_author_id_fkey ( full_name, avatar_url ),
      workout_logs ( session_id, new_prs, total_volume, total_sets_completed )
    `
    )
    .eq("id", id)
    .eq("post_type", "workout_summary")
    .maybeSingle();
  if (post && (post as any).workout_logs) return { post, workoutLog: (post as any).workout_logs };

  if (!logAllowed) return null;

  const { data: log } = await supabase
    .from("workout_logs")
    .select("id, athlete_id, group_id, session_id, new_prs, total_volume, total_sets_completed, created_at")
    .eq("id", id)
    .maybeSingle();
  if (!log || !(log as any).athlete_id) return null;

  const { data: profile } = await supabase.from("profiles").select("full_name, avatar_url, feed_broadcast_level").eq("id", (log as any).athlete_id).maybeSingle();
  // The client's own sharing level still applies: "check-in only" and "PRs only" show less on the card; "private" (no post) shows it in full, as the post code does.
  const level = (profile as any)?.feed_broadcast_level;
  return {
    post: {
      id: (log as any).id,
      post_type: "workout_summary",
      created_at: (log as any).created_at,
      group_id: (log as any).group_id,
      broadcast_level: level === "prs_only" || level === "checkin_only" ? level : "full",
      author_id: (log as any).athlete_id,
      shared_exercise_names: null,
      profiles: profile ?? null,
    },
    workoutLog: {
      session_id: (log as any).session_id,
      new_prs: (log as any).new_prs,
      total_volume: (log as any).total_volume,
      total_sets_completed: (log as any).total_sets_completed,
    },
  };
}
