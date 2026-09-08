import Link from "next/link";
import { createServerClient } from "@/lib/supabase/server";
import { FeedList } from "@/components/feed/feed-list";
import { NewPostComposer } from "@/components/feed/new-post-composer";
import { PostComposerDesktop } from "@/components/feed/desktop/post-composer-desktop";
import { ChannelTabs } from "@/components/feed/channel-tabs";
import { BottomTabBar } from "@/components/athlete/bottom-tab-bar";
import { CoachDesktopShell } from "@/components/coach/coach-desktop-shell";
import { prefersAthleteStyleView } from "@/lib/pwa-server";
import type { FeedChannel, FeedPost } from "@/lib/types";

const VALID_CHANNELS: FeedChannel[] = ["announcements", "form_checks", "pr_board", "general"];

export default async function FeedPage({
  params,
  searchParams,
}: {
  params: { groupId: string };
  searchParams: { channel?: string };
}) {
  const supabase = createServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  const { data: membership } = await supabase
    .from("group_memberships")
    .select("role")
    .eq("group_id", params.groupId)
    .eq("profile_id", user?.id ?? "")
    .maybeSingle();

  const isCoach = membership?.role === "coach";
  // A coach opening the installed home-screen app gets the same mobile
  // feed an athlete gets, so they can post/react/comment naturally
  // instead of the desktop composer built for running a business.
  const showMobileView = !isCoach || prefersAthleteStyleView();

  const channel: FeedChannel = VALID_CHANNELS.includes(searchParams.channel as FeedChannel)
    ? (searchParams.channel as FeedChannel)
    : "general";

  const { data: posts } = await supabase
    .from("posts")
    .select(
      `
      id, post_type, channel, pinned_at, body, media_url, media_type, created_at, broadcast_level,
      profiles!posts_author_id_fkey ( id, full_name, avatar_url ),
      workout_logs ( total_volume, total_sets_completed, new_prs, logged_by_coach ),
      reactions ( profile_id ),
      comments ( id )
    `
    )
    .eq("group_id", params.groupId)
    .eq("channel", channel)
    .order("pinned_at", { ascending: false, nullsFirst: false })
    .order("created_at", { ascending: false })
    .limit(30);

  const shaped: FeedPost[] = (posts ?? []).map((p: any) => ({
    id: p.id,
    groupId: params.groupId,
    postType: p.post_type,
    channel: p.channel,
    pinnedAt: p.pinned_at,
    body: p.body,
    mediaUrl: p.media_url,
    mediaType: p.media_type,
    createdAt: p.created_at,
    author: {
      id: p.profiles.id,
      fullName: p.profiles.full_name,
      avatarUrl: p.profiles.avatar_url,
    },
    workoutSummary: p.workout_logs
      ? {
          totalVolume: p.workout_logs.total_volume,
          totalSetsCompleted: p.workout_logs.total_sets_completed,
          newPrs: p.workout_logs.new_prs ?? [],
          loggedByCoach: p.workout_logs.logged_by_coach ?? false,
          broadcastLevel: p.broadcast_level ?? "full",
        }
      : null,
    reactionCount: p.reactions?.length ?? 0,
    viewerHasReacted: (p.reactions ?? []).some(
      (r: any) => r.profile_id === user?.id
    ),
    commentCount: p.comments?.length ?? 0,
  }));

  if (isCoach && !showMobileView) {
    const { data: group } = await supabase
      .from("groups")
      .select("name")
      .eq("id", params.groupId)
      .single();

    return (
      <CoachDesktopShell
        groupId={params.groupId}
        groupName={group?.name ?? "Coaching"}
        active="feed"
      >
        <div className="pb-6 border-b border-steel/20 mb-6">
          <h1 className="font-display font-bold text-3xl uppercase leading-none">Team Feed</h1>
        </div>

        <div className="max-w-[640px]">
          <ChannelTabs basePath={`/groups/${params.groupId}/feed`} active={channel} />
          <div className="pt-6">
            <PostComposerDesktop
              groupId={params.groupId}
              defaultChannel={channel}
              isCoach={isCoach}
            />
            <FeedList
              key={channel}
              groupId={params.groupId}
              initialPosts={shaped}
              viewerId={user?.id ?? null}
              channel={channel}
              isCoach={isCoach}
            />
          </div>
        </div>
      </CoachDesktopShell>
    );
  }

  return (
    <main className="min-h-screen bg-graphite text-chalk font-body pb-28">
      <header className="px-5 pt-8 pb-4 border-b border-steel/20">
        <Link
          href={`/groups/${params.groupId}`}
          className="font-body text-xs text-steel uppercase tracking-wide"
        >
          &larr; Back to group
        </Link>
        <h1 className="font-display font-bold text-3xl uppercase leading-none mt-3">
          Team feed
        </h1>
      </header>

      <ChannelTabs basePath={`/groups/${params.groupId}/feed`} active={channel} />

      <FeedList
        key={channel}
        groupId={params.groupId}
        initialPosts={shaped}
        viewerId={user?.id ?? null}
        channel={channel}
        isCoach={isCoach}
      />
      <NewPostComposer
        groupId={params.groupId}
        raised={showMobileView}
        defaultChannel={channel}
        isCoach={isCoach}
      />

      {showMobileView && <BottomTabBar groupId={params.groupId} activeOverride="feed" />}
    </main>
  );
}
