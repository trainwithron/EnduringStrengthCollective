import { redirect } from "next/navigation";
import { cookies } from "next/headers";
import { createServerClient } from "@/lib/supabase/server";
import { CoachHomeShell } from "@/components/coach/coach-home-shell";
import { CoachDesktopShell } from "@/components/coach/coach-desktop-shell";
import { HomeClientCard, type HomeClientCardData } from "@/components/coach/desktop/home-client-card";
import { HomeGroupCard, type HomeGroupCardData } from "@/components/coach/desktop/home-group-card";
import { NeedsReplyPanel, type NeedsReplyThread } from "@/components/coach/desktop/needs-reply-panel";
import { MarkAllSeenButton } from "@/components/coach/desktop/mark-all-seen-button";
import { findThreadsNeedingReply } from "@/lib/notification-priority";

interface GroupRow {
  id: string;
  name: string;
  focus_tag: string | null;
  group_kind: string | null;
}

export default async function CoachHomePage() {
  const supabase = await createServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect("/login");
  }

  const { data: isCoachAnywhere } = await supabase
    .from("group_memberships")
    .select("group_id")
    .eq("profile_id", user.id)
    .eq("role", "coach")
    .limit(1)
    .maybeSingle();

  if (!isCoachAnywhere) {
    return (
      <main className="min-h-screen bg-graphite text-chalk flex items-center justify-center px-6">
        <p className="font-body text-steel text-center">Only coaches have a home dashboard.</p>
      </main>
    );
  }

  const { data: orgMembership } = await supabase
    .from("organization_memberships")
    .select("organization_id, role")
    .eq("profile_id", user.id)
    .maybeSingle();

  const { data: org } = orgMembership
    ? await supabase
        .from("organizations")
        .select("name, display_name")
        .eq("id", orgMembership.organization_id)
        .maybeSingle()
    : { data: null };

  // Same merge shape GroupSwitcher already uses: every group this coach
  // coaches, plus every group in the org if they're an owner/admin.
  const byId = new Map<string, GroupRow>();

  const { data: coachedRows } = await supabase
    .from("group_memberships")
    .select("groups ( id, name, focus_tag, group_kind )")
    .eq("profile_id", user.id)
    .eq("role", "coach");
  for (const row of coachedRows ?? []) {
    const g = (row as any).groups as GroupRow | null;
    if (g) byId.set(g.id, g);
  }

  if (orgMembership && (orgMembership.role === "owner" || orgMembership.role === "admin")) {
    const { data: allGroups } = await supabase
      .from("groups")
      .select("id, name, focus_tag, group_kind")
      .eq("organization_id", orgMembership.organization_id)
      .order("name");
    for (const g of allGroups ?? []) byId.set(g.id, g as GroupRow);
  }

  const allGroups = [...byId.values()];
  const soloGroups = allGroups.filter((g) => g.group_kind === "one_on_one");
  const socialGroups = allGroups.filter((g) => g.group_kind === "social").sort((a, b) => a.name.localeCompare(b.name));
  const teamGroups = allGroups
    .filter((g) => g.group_kind === "team" || !g.group_kind)
    .sort((a, b) => a.name.localeCompare(b.name));

  // "Has something new happened here" dot — same coach_view_state data
  // and same signals (posts since feed_seen_at, workout_logs since
  // clients_seen_at) already driving the sidebar's unread counts inside
  // a group, just collapsed to a boolean for the Home card. A group with
  // no coach_view_state row yet (never visited) gets no dot — nothing to
  // compare against, matching the existing "don't flood on first look"
  // rule the shell's own seeding already follows.
  const allGroupIds = allGroups.map((g) => g.id);
  const unseenByGroup = new Map<string, boolean>();
  if (allGroupIds.length > 0) {
    const { data: viewStateRows } = await supabase
      .from("coach_view_state")
      .select("group_id, feed_seen_at, clients_seen_at")
      .eq("coach_id", user.id)
      .in("group_id", allGroupIds);

    const seenByGroup = new Map<string, { feed: string | null; clients: string | null }>();
    for (const row of viewStateRows ?? []) {
      seenByGroup.set(row.group_id, { feed: row.feed_seen_at, clients: row.clients_seen_at });
    }

    if (seenByGroup.size > 0) {
      const visitedGroupIds = [...seenByGroup.keys()];
      const [{ data: recentPosts }, { data: recentGroupLogs }] = await Promise.all([
        supabase.from("posts").select("group_id, created_at").in("group_id", visitedGroupIds),
        supabase.from("workout_logs").select("group_id, created_at").in("group_id", visitedGroupIds),
      ]);

      for (const groupId of visitedGroupIds) {
        const seen = seenByGroup.get(groupId)!;
        const hasNewPost = (recentPosts ?? []).some(
          (p) => p.group_id === groupId && (!seen.feed || p.created_at > seen.feed)
        );
        const hasNewLog = (recentGroupLogs ?? []).some(
          (l) => l.group_id === groupId && (!seen.clients || l.created_at > seen.clients)
        );
        unseenByGroup.set(groupId, hasNewPost || hasNewLog);
      }
    }
  }

  // Member counts for team/social group cards.
  const teamAndSocialIds = [...teamGroups, ...socialGroups].map((g) => g.id);
  const memberCountByGroup = new Map<string, number>();
  if (teamAndSocialIds.length > 0) {
    const { data: memberRows } = await supabase
      .from("group_memberships")
      .select("group_id")
      .in("group_id", teamAndSocialIds);
    for (const row of memberRows ?? []) {
      memberCountByGroup.set(row.group_id, (memberCountByGroup.get(row.group_id) ?? 0) + 1);
    }
  }

  // "Needs a reply" — the one thing worth surfacing from a big/social
  // group's ordinary feed chatter (per the notification-priority design):
  // a question that's gone unanswered a while. Computed on read from
  // real comment timestamps, no scheduled job. Deliberately excludes
  // 1-on-1 groups — those already get prompt, direct notification on the
  // client's own activity (see complete-workout-button.tsx), not a
  // dashboard staleness check.
  let needsReplyThreads: NeedsReplyThread[] = [];
  if (teamAndSocialIds.length > 0) {
    const [{ data: commentRows }, { data: dismissedRows }] = await Promise.all([
      supabase
        .from("comments")
        .select("post_id, group_id, author_id, created_at, body, profiles ( full_name )")
        .in("group_id", teamAndSocialIds),
      supabase
        .from("coach_dismissed_reply_alerts")
        .select("post_id, dismissed_at")
        .eq("coach_id", user.id),
    ]);

    const dismissedAt = new Map((dismissedRows ?? []).map((d) => [d.post_id, d.dismissed_at]));

    const stale = findThreadsNeedingReply(
      (commentRows ?? []).map((c) => ({
        postId: c.post_id,
        groupId: c.group_id,
        authorId: c.author_id,
        createdAt: c.created_at,
      })),
      user.id,
      new Date(),
      8,
      dismissedAt
    );

    if (stale.length > 0) {
      const postIds = stale.map((t) => t.postId);
      const { data: postRows } = await supabase.from("posts").select("id, channel").in("id", postIds);
      const channelByPostId = new Map((postRows ?? []).map((p) => [p.id, p.channel]));

      // The exact comment row behind each stale thread — same (postId,
      // createdAt) pair findThreadsNeedingReply already picked as "the
      // latest" — so the alert can show who said what, not just a count.
      const commentByKey = new Map(
        (commentRows ?? []).map((c) => [`${c.post_id}:${c.created_at}`, c])
      );

      const nameByGroupId = new Map([...teamGroups, ...socialGroups].map((g) => [g.id, g.name]));
      needsReplyThreads = stale.map((t) => {
        const comment = commentByKey.get(`${t.postId}:${t.lastCommentAt}`) as any;
        return {
          postId: t.postId,
          groupId: t.groupId,
          groupName: nameByGroupId.get(t.groupId) ?? "Group",
          channel: channelByPostId.get(t.postId) ?? "general",
          authorName: comment?.profiles?.full_name ?? "Someone",
          snippet: comment?.body ?? "",
        };
      });
    }
  }

  // A 1-on-1 client's group has exactly one athlete member — fetch that
  // member's profile plus their most recent workout_logs entry, same
  // lastLogByAthlete pattern already used on the Clients roster page.
  const soloGroupIds = soloGroups.map((g) => g.id);
  let clientCards: HomeClientCardData[] = [];
  if (soloGroupIds.length > 0) {
    const { data: athleteRows } = await supabase
      .from("group_memberships")
      .select("group_id, profile_id, profiles ( full_name, avatar_url )")
      .in("group_id", soloGroupIds)
      .eq("role", "athlete");

    const { data: recentLogs } = await supabase
      .from("workout_logs")
      .select("athlete_id, created_at")
      .in("group_id", soloGroupIds)
      .order("created_at", { ascending: false });
    const lastLogByAthlete = new Map<string, string>();
    for (const log of recentLogs ?? []) {
      if (!lastLogByAthlete.has(log.athlete_id)) {
        lastLogByAthlete.set(log.athlete_id, log.created_at);
      }
    }

    clientCards = (athleteRows ?? []).map((row) => {
      const profile = (row as any).profiles;
      return {
        groupId: row.group_id,
        athleteId: row.profile_id,
        fullName: profile?.full_name ?? "Client",
        avatarUrl: profile?.avatar_url ?? null,
        lastWorkoutAt: lastLogByAthlete.get(row.profile_id) ?? null,
        hasUnseenActivity: unseenByGroup.get(row.group_id) ?? false,
      };
    });

    // Needs-attention first — same comparator ClientCardGrid already uses.
    clientCards.sort((a, b) => {
      const daysSince = (at: string | null) =>
        at ? Math.floor((Date.now() - new Date(at).getTime()) / (1000 * 60 * 60 * 24)) : Infinity;
      return daysSince(b.lastWorkoutAt) - daysSince(a.lastWorkoutAt);
    });
  }

  const teamCards: HomeGroupCardData[] = teamGroups.map((g) => ({
    id: g.id,
    name: g.name,
    focusTag: g.focus_tag,
    memberCount: memberCountByGroup.get(g.id) ?? 0,
    hasUnseenActivity: unseenByGroup.get(g.id) ?? false,
  }));
  const socialCards: HomeGroupCardData[] = socialGroups.map((g) => ({
    id: g.id,
    name: g.name,
    focusTag: g.focus_tag,
    memberCount: memberCountByGroup.get(g.id) ?? 0,
    hasUnseenActivity: unseenByGroup.get(g.id) ?? false,
  }));

  const orgName = org?.display_name || org?.name || "Your Coaching Business";

  const content = (
    <>
      <div className="flex items-center justify-between mb-6">
        <h1 className="font-display font-bold text-2xl uppercase">Home</h1>
        <MarkAllSeenButton groupIds={allGroupIds} />
      </div>

      <NeedsReplyPanel coachId={user.id} threads={needsReplyThreads} />

      <section className="mb-10">
        <h2 className="font-display uppercase text-sm tracking-wide text-steel mb-3">1-on-1 Clients</h2>
        {clientCards.length === 0 ? (
          <p className="font-body text-sm text-steel">No 1-on-1 clients yet.</p>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
            {clientCards.map((c) => (
              <HomeClientCard key={c.athleteId} client={c} />
            ))}
          </div>
        )}
      </section>

      <section className="mb-10">
        <h2 className="font-display uppercase text-sm tracking-wide text-steel mb-3">Groups</h2>
        {teamCards.length === 0 ? (
          <p className="font-body text-sm text-steel">No groups yet.</p>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
            {teamCards.map((g) => (
              <HomeGroupCard key={g.id} group={g} />
            ))}
          </div>
        )}
      </section>

      {socialCards.length > 0 && (
        <section>
          <h2 className="font-display uppercase text-sm tracking-wide text-steel mb-3">Social Groups</h2>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
            {socialCards.map((g) => (
              <HomeGroupCard key={g.id} group={g} />
            ))}
          </div>
        </section>
      )}
    </>
  );

  // A coach who's actually navigated into a group before gets the real
  // full nav (Programming/Clients/Business/etc.) on Home too, scoped to
  // whichever group they looked at most recently — set by
  // CoachDesktopShell itself on mount. Validated against the coach's own
  // real group list so a stale/forged cookie can never point Home's nav
  // at a group they don't actually have access to; falls back to the
  // minimal shell before that cookie exists at all (a brand-new coach).
  const lastGroupCookie = (await cookies()).get("last_group")?.value;
  let lastGroup: { id: string; name: string } | null = null;
  if (lastGroupCookie) {
    try {
      const parsed = JSON.parse(decodeURIComponent(lastGroupCookie));
      if (parsed?.id && allGroups.some((g) => g.id === parsed.id)) {
        lastGroup = { id: parsed.id, name: parsed.name ?? "Group" };
      }
    } catch {
      // Malformed cookie — fall through to the minimal shell.
    }
  }

  if (lastGroup) {
    return (
      <CoachDesktopShell groupId={lastGroup.id} groupName={lastGroup.name} active="home">
        {content}
      </CoachDesktopShell>
    );
  }

  return <CoachHomeShell orgName={orgName}>{content}</CoachHomeShell>;
}
