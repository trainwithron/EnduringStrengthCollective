// What happens when a workout log should be shown to the world: the feed card (respecting the client's own sharing choice) and the link to its celebratory share card. One function used by finishing a
// workout AND by a client agreeing to count a record from imported history, so the two can never drift apart. Fire it from the client's own device (the post is theirs).
import type { SupabaseClient } from "@supabase/supabase-js";

export interface AnnounceInput {
  workoutLogId: string;
  athleteId: string;
  groupId: string;
  broadcastLevel: string; // the client's feed_broadcast_level: full, prs_only, checkin_only or private
  hasPrs: boolean;
  skipPost?: boolean; // e.g. a coach logging for a client who is under 18
  skipLink?: boolean; // the caller goes somewhere else and needs no share link
}

// Whether the feed gets a card: not when the client keeps it private, not a prs-only client's workout with no record, and not when the caller says so.
export function shouldPostToFeed(broadcastLevel: string, hasPrs: boolean, skipPost = false): boolean {
  return broadcastLevel !== "private" && !(broadcastLevel === "prs_only" && !hasPrs) && !skipPost;
}

// A "check-in only" post never reveals record content, so it never belongs in the PR board even when a record really happened.
export function feedChannel(broadcastLevel: string, hasPrs: boolean): "pr_board" | "general" {
  return broadcastLevel !== "checkin_only" && hasPrs ? "pr_board" : "general";
}

export async function announceWorkoutLog(supabase: SupabaseClient, input: AnnounceInput): Promise<{ postId: string | null; href: string | null }> {
  const { workoutLogId, athleteId, groupId, broadcastLevel, hasPrs } = input;
  let postId: string | null = null;
  if (shouldPostToFeed(broadcastLevel, hasPrs, input.skipPost)) {
    // One card per workout, even if this ran twice. The sharing choice is stored on the post itself so the card renders the same even if they change the setting later.
    const { data: alreadyPosted } = await supabase.from("posts").select("id").eq("workout_log_id", workoutLogId).eq("post_type", "workout_summary").maybeSingle();
    const { data: post } = alreadyPosted
      ? { data: alreadyPosted }
      : await supabase
          .from("posts")
          .insert({
            group_id: groupId,
            author_id: athleteId,
            post_type: "workout_summary",
            workout_log_id: workoutLogId,
            channel: feedChannel(broadcastLevel, hasPrs),
            broadcast_level: broadcastLevel === "private" ? "full" : broadcastLevel,
          })
          .select("id")
          .single();
    postId = post?.id ?? null;
  }
  if (input.skipLink) return { postId, href: null };
  // The card is built from the workout itself when there is no feed post (a client who keeps their workouts off the group feed, or a one-on-one client).
  if (postId) return { postId, href: `/share/${postId}` };
  // The link is signed by the server, so only the client (or their coach) can make it.
  try {
    const res = await fetch("/api/share/sign", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ workoutLogId }) });
    const data = res.ok ? await res.json() : null;
    return { postId, href: typeof data?.href === "string" ? (data.href as string) : null };
  } catch {
    // The workout itself is saved either way.
    return { postId, href: null };
  }
}
