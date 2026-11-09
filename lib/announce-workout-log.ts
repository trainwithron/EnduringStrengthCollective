// What happens when a workout log should be shown to the world: the feed card (respecting the client's own sharing choice) and the link to its celebratory share card. One function used by finishing a
// workout AND by a client agreeing to count a record from imported history, so the two can never drift apart. Fire it from the client's own device (the post is theirs).
import type { SupabaseClient } from "@supabase/supabase-js";
import { postWorkoutCardsOn } from "@/lib/post-workout-cards";

export interface AnnounceInput {
  workoutLogId: string;
  athleteId: string;
  groupId: string;
  broadcastLevel: string; // the client's feed_broadcast_level: full, prs_only, checkin_only or private
  hasPrs: boolean;
  skipPost?: boolean; // e.g. a coach logging for a client who is under 18
  skipLink?: boolean; // the caller goes somewhere else and needs no share link
  skipSharedGroups?: boolean; // no card in the shared groups the client shares with either (a coach logging for a client under 18)
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
    // In THIS group: the same workout can also have a card in a shared group the client shares with (below).
    const { data: alreadyPosted } = await supabase.from("posts").select("id").eq("workout_log_id", workoutLogId).eq("post_type", "workout_summary").eq("group_id", groupId).maybeSingle();
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
  // The client's shared group(s) they chose to share their workouts with get the same card (same sharing rules); it never changes what happens in their own group.
  if (!input.skipSharedGroups && shouldPostToFeed(broadcastLevel, hasPrs)) {
    await postToSharedGroups(supabase, { workoutLogId, athleteId, groupId, broadcastLevel, hasPrs }).catch(() => {});
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

// The shared groups this client joined and chose to share their workouts with (a social-only seat with shares_workouts on, step 202): one card per workout in each, in General or the PR Board by
// the same rule as their own group, and only where that group has its post-workout cards on. Before step 202 the read fails and nothing is posted.
export async function postToSharedGroups(
  supabase: SupabaseClient,
  input: { workoutLogId: string; athleteId: string; groupId: string; broadcastLevel: string; hasPrs: boolean }
): Promise<string[]> {
  const { workoutLogId, athleteId, groupId, broadcastLevel, hasPrs } = input;
  if (!shouldPostToFeed(broadcastLevel, hasPrs)) return [];
  const { data, error } = await supabase
    .from("group_memberships")
    .select("group_id, groups ( post_workout_cards, team_mode )")
    .eq("profile_id", athleteId)
    .eq("role", "athlete")
    .eq("membership_type", "social_only")
    .eq("shares_workouts", true);
  if (error || !data) return [];
  const posted: string[] = [];
  for (const row of data as Array<{ group_id: string; groups: SharedGroupRow | SharedGroupRow[] | null }>) {
    const sharedId = row.group_id;
    if (!sharedId || sharedId === groupId) continue;
    const g = Array.isArray(row.groups) ? row.groups[0] : row.groups;
    if (!postWorkoutCardsOn(g?.post_workout_cards, g?.team_mode)) continue;
    const { data: already } = await supabase.from("posts").select("id").eq("workout_log_id", workoutLogId).eq("post_type", "workout_summary").eq("group_id", sharedId).maybeSingle();
    if (already) continue;
    const { data: post } = await supabase
      .from("posts")
      .insert({
        group_id: sharedId,
        author_id: athleteId,
        post_type: "workout_summary",
        workout_log_id: workoutLogId,
        channel: feedChannel(broadcastLevel, hasPrs),
        broadcast_level: broadcastLevel,
      })
      .select("id")
      .single();
    if (post?.id) posted.push(post.id as string);
  }
  return posted;
}

type SharedGroupRow = { post_workout_cards?: boolean | null; team_mode?: boolean | null };
