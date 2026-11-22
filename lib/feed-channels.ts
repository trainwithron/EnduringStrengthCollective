import type { SupabaseClient } from "@supabase/supabase-js";
import type { FeedChannel } from "@/lib/types";

// Which feed channels show as tabs (CL17, Ron Nov 21: five tabs always showed and scrolled sideways, even empty, and "General" and "Team Chat" overlapped).
//   * A group that is not a team-sport one has one place to talk: General shows Team Chat's posts too, and there is no Team Chat tab (an old ?channel=team_chat link opens General).
//     A team-sport group keeps Team Chat, as before.
//   * A tab shows when its channel has posts, and always for the one open, for General (where the feed opens) and, for a coach, Announcements (where they post one). The empty
//     ones are behind "More", so the first post in an empty channel is still one tap away.
export const ALL_FEED_CHANNELS: FeedChannel[] = ["announcements", "form_checks", "pr_board", "general", "team_chat"];

/** The channel a request opens: an unknown one is General, and Team Chat is General outside a team-sport group. */
export function openedChannel(requested: string | undefined, teamSport: boolean): FeedChannel {
  const c = ALL_FEED_CHANNELS.includes(requested as FeedChannel) ? (requested as FeedChannel) : "general";
  return c === "team_chat" && !teamSport ? "general" : c;
}

/** The channels whose posts a tab lists: General also lists Team Chat's outside a team-sport group. */
export function channelsRead(channel: FeedChannel, teamSport: boolean): FeedChannel[] {
  return channel === "general" && !teamSport ? ["general", "team_chat"] : [channel];
}

export function feedTabs({ withPosts, active, teamSport, isCoach }: { withPosts: ReadonlySet<FeedChannel>; active: FeedChannel; teamSport: boolean; isCoach: boolean }): {
  shown: FeedChannel[];
  more: FeedChannel[];
} {
  const channels = ALL_FEED_CHANNELS.filter((c) => teamSport || c !== "team_chat");
  const has = (c: FeedChannel) => withPosts.has(c) || (c === "general" && !teamSport && withPosts.has("team_chat"));
  const shown = channels.filter((c) => c === active || c === "general" || (c === "announcements" && isCoach) || has(c));
  return { shown, more: channels.filter((c) => !shown.includes(c)) };
}

/** Which channels of a group have at least one post (one tiny read per channel). A failed read counts as having posts, so a tab is never lost to a hiccup. */
export async function channelsWithPosts(supabase: SupabaseClient, groupId: string): Promise<Set<FeedChannel>> {
  const results = await Promise.all(
    ALL_FEED_CHANNELS.map(async (c) => {
      const { data, error } = await supabase.from("posts").select("id").eq("group_id", groupId).eq("channel", c).limit(1);
      return error || (data ?? []).length > 0 ? c : null;
    })
  );
  return new Set(results.filter((c): c is FeedChannel => c !== null));
}

/** The feed page's title: "Team feed" only for a team-sport group (CL17: a gym's group is not a team). */
export const feedTitle = (teamSport: boolean): string => (teamSport ? "Team feed" : "Feed");
