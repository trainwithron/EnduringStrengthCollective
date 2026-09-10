import Link from "next/link";
import { redirect } from "next/navigation";
import { createServerClient } from "@/lib/supabase/server";
import { FeedList } from "@/components/feed/feed-list";
import { NewPostComposer } from "@/components/feed/new-post-composer";
import { PostComposerDesktop } from "@/components/feed/desktop/post-composer-desktop";
import { ChannelTabs } from "@/components/feed/channel-tabs";
import { FeedSettingsButton } from "@/components/feed/feed-settings-button";
import { ClearChannelButton } from "@/components/feed/clear-channel-button";
import { BottomTabBar } from "@/components/athlete/bottom-tab-bar";
import { ActingAsBanner } from "@/components/athlete/acting-as-banner";
import { CoachDesktopShell } from "@/components/coach/coach-desktop-shell";
import { LiveGroupLeaderboard } from "@/components/leaderboard/live-group-leaderboard";
import { getGroupLeaderboardRankings } from "@/lib/leaderboard-data";
import { prefersAthleteStyleView } from "@/lib/pwa-server";
import { getEffectiveAthlete } from "@/lib/acting-as";
import type { FeedChannel, FeedPost } from "@/lib/types";

const VALID_CHANNELS: FeedChannel[] = ["announcements", "form_checks", "pr_board", "general"];

export default async function FeedPage(
  props: {
    params: Promise<{ groupId: string }>;
    searchParams: Promise<{ channel?: string }>;
  }
) {
  const searchParams = await props.searchParams;
  const params = await props.params;
  const supabase = await createServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  const { data: membership } = await supabase
    .from("group_memberships")
    .select("role, client_tier")
    .eq("group_id", params.groupId)
    .eq("profile_id", user?.id ?? "")
    .maybeSingle();

  const isCoach = membership?.role === "coach";

  // A coach "acting as" a client sees that client's real Team Feed — their
  // own reactions, their own posting identity — not the coach's. `isCoach`
  // above still reflects the real signed-in user, so the desktop-shell
  // branch below stays correctly gated.
  const effective = user ? await getEffectiveAthlete(params.groupId, user.id) : null;
  const isActingAsOther = effective?.isActingAsOther ?? false;
  const athleteId = effective?.athleteId ?? user?.id ?? null;

  // A 1-on-1 client has no team feed to see — server-side backstop for
  // the same rule the bottom tab bar already hides the link for, in case
  // someone lands here directly. Checked against whichever athlete this
  // page is actually being viewed as.
  if (isActingAsOther) {
    const { data: actingAsMembership } = await supabase
      .from("group_memberships")
      .select("client_tier")
      .eq("group_id", params.groupId)
      .eq("profile_id", athleteId ?? "")
      .maybeSingle();
    if (actingAsMembership?.client_tier === "one_on_one") {
      redirect(`/groups/${params.groupId}`);
    }
  } else if (membership?.role === "athlete" && membership.client_tier === "one_on_one") {
    redirect(`/groups/${params.groupId}`);
  }

  // A coach opening the installed home-screen app gets the same mobile
  // feed an athlete gets, so they can post/react/comment naturally
  // instead of the desktop composer built for running a business. Acting
  // as a client always wins, same rule as the Home page.
  const showMobileView = isActingAsOther || !isCoach || await prefersAthleteStyleView();

  const channel: FeedChannel = VALID_CHANNELS.includes(searchParams.channel as FeedChannel)
    ? (searchParams.channel as FeedChannel)
    : "general";

  const { data: viewerProfile } = athleteId
    ? await supabase.from("profiles").select("full_name, feed_broadcast_level").eq("id", athleteId).maybeSingle()
    : { data: null };
  const feedBroadcastLevel =
    (viewerProfile?.feed_broadcast_level as "full" | "prs_only" | "checkin_only" | "private") ?? "full";

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
      (r: any) => r.profile_id === athleteId
    ),
    commentCount: p.comments?.length ?? 0,
  }));

  // Leaderboard now lives at the top of General instead of its own nav
  // tab — every post is a reminder it's there, per the ask ("every time
  // anything gets posted, everyone can see the leaderboard").
  const leaderboard = channel === "general" ? await getGroupLeaderboardRankings(supabase, params.groupId) : null;
  const leaderboardCard = leaderboard && (
    <div className="border border-steel/20 p-4 mb-4">
      <h2 className="font-display uppercase text-sm tracking-wide text-steel mb-3">Leaderboard</h2>
      <LiveGroupLeaderboard
        groupId={params.groupId}
        initialRankings={leaderboard}
        viewerId={athleteId}
      />
    </div>
  );

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
          <div className="flex items-center justify-between">
            <ChannelTabs basePath={`/groups/${params.groupId}/feed`} active={channel} />
            <ClearChannelButton groupId={params.groupId} channel={channel} />
          </div>
          <div className="pt-6">
            {leaderboardCard}
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

  // A coach viewing this as the impersonated client never sees coach-only
  // controls (Pin, Announcements posting) — those belong to the client's
  // real experience, not the coach's own.
  const renderAsCoach = isActingAsOther ? false : isCoach;

  return (
    <main className="min-h-screen bg-graphite text-chalk font-body pb-28">
      {isActingAsOther && (
        <ActingAsBanner athleteFullName={viewerProfile?.full_name ?? "Client"} groupId={params.groupId} />
      )}
      <header className="px-5 pt-8 pb-4 border-b border-steel/20">
        <Link
          href={`/groups/${params.groupId}`}
          className="font-body text-xs text-steel uppercase tracking-wide"
        >
          &larr; Back to group
        </Link>
        <div className="flex items-center justify-between mt-3">
          <h1 className="font-display font-bold text-3xl uppercase leading-none">
            Team feed
          </h1>
          <div className="flex items-center">
            <ClearChannelButton groupId={params.groupId} channel={channel} />
            {athleteId && <FeedSettingsButton initialLevel={feedBroadcastLevel} profileId={athleteId} />}
          </div>
        </div>
      </header>

      <ChannelTabs basePath={`/groups/${params.groupId}/feed`} active={channel} />

      {leaderboardCard && <div className="px-5">{leaderboardCard}</div>}

      <FeedList
        key={channel}
        groupId={params.groupId}
        initialPosts={shaped}
        viewerId={athleteId}
        channel={channel}
        isCoach={renderAsCoach}
      />
      <NewPostComposer
        groupId={params.groupId}
        raised={showMobileView}
        defaultChannel={channel}
        isCoach={renderAsCoach}
        authorId={athleteId}
      />

      {showMobileView && <BottomTabBar groupId={params.groupId} activeOverride="feed" />}
    </main>
  );
}
