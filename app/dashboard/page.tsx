import { redirect } from "next/navigation";
import { cookies } from "next/headers";
import { createServerClient } from "@/lib/supabase/server";
import { CoachHomeShell } from "@/components/coach/coach-home-shell";
import { CoachDesktopShell } from "@/components/coach/coach-desktop-shell";
import type { HomeClientCardData } from "@/components/coach/desktop/home-client-card";
import type { HomeGroupCardData } from "@/components/coach/desktop/home-group-card";
import { NeedsReplyPanel, type NeedsReplyThread } from "@/components/coach/desktop/needs-reply-panel";
import { MarkAllSeenButton } from "@/components/coach/desktop/mark-all-seen-button";
import { findThreadsNeedingReply } from "@/lib/notification-priority";
import { getCoachDashboardData } from "@/lib/dashboard-data";
import { DashboardHero } from "@/components/coach/desktop/dashboard-hero";
import { PulseTabs } from "@/components/coach/desktop/pulse-tabs";
import { DashboardStatTiles } from "@/components/coach/desktop/dashboard-stat-tiles";
import { DashboardTodayPanel } from "@/components/coach/desktop/dashboard-today-panel";
import { DashboardWeekNarrative } from "@/components/coach/desktop/dashboard-week-narrative";
import { DashboardAutoRefresh } from "@/components/coach/desktop/dashboard-auto-refresh";
import { DashboardTileGrid } from "@/components/coach/desktop/dashboard-tile-grid";
import {
  CollectiveIntelligencePanel,
  type CollectiveIntelligenceItem,
} from "@/components/coach/desktop/collective-intelligence-panel";
import { CollectiveIntelligenceChat } from "@/components/coach/desktop/collective-intelligence-chat";

interface GroupRow {
  id: string;
  name: string;
  focus_tag: string | null;
  group_kind: string | null;
  organization_id: string | null;
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

  // A coach can own/admin more than one organization (e.g. running
  // several client orgs at once) — fetching every row here, not just
  // one, so Home aggregates groups across ALL of them rather than
  // silently collapsing to just the directly-coached groups the moment
  // there's more than one org membership.
  const { data: orgMemberships } = await supabase
    .from("organization_memberships")
    .select("organization_id, role")
    .eq("profile_id", user.id);

  const primaryOrgMembership = orgMemberships?.[0] ?? null;
  const { data: org } = primaryOrgMembership
    ? await supabase
        .from("organizations")
        .select("name, display_name")
        .eq("id", primaryOrgMembership.organization_id)
        .maybeSingle()
    : { data: null };

  // Same merge shape GroupSwitcher already uses: every group this coach
  // coaches, plus every group in each org where they're an owner/admin.
  const byId = new Map<string, GroupRow>();

  const { data: coachedRows } = await supabase
    .from("group_memberships")
    .select("groups ( id, name, focus_tag, group_kind, organization_id )")
    .eq("profile_id", user.id)
    .eq("role", "coach");
  for (const row of coachedRows ?? []) {
    const g = (row as any).groups as GroupRow | null;
    if (g) byId.set(g.id, g);
  }

  const adminOrgIds = (orgMemberships ?? [])
    .filter((m) => m.role === "owner" || m.role === "admin")
    .map((m) => m.organization_id);
  if (adminOrgIds.length > 0) {
    const { data: allGroupRows } = await supabase
      .from("groups")
      .select("id, name, focus_tag, group_kind, organization_id")
      .in("organization_id", adminOrgIds)
      .order("name");
    for (const g of allGroupRows ?? []) byId.set(g.id, g as GroupRow);
  }

  // A coach who administers more than one organization needs each group's
  // items on Home labeled with which org they're from — otherwise a
  // pinned flag, a Team Pulse card, or a client card is indistinguishable
  // from one belonging to a completely different org, even though Home
  // correctly aggregates across all of them. Invisible (empty map) for
  // the common single-org coach.
  const distinctOrgIds = [...new Set([...byId.values()].map((g) => g.organization_id).filter((id): id is string => !!id))];
  const orgNameById = new Map<string, string>();
  if (distinctOrgIds.length > 1) {
    const { data: orgRows } = await supabase
      .from("organizations")
      .select("id, name, display_name")
      .in("id", distinctOrgIds);
    for (const o of orgRows ?? []) {
      orgNameById.set(o.id, o.display_name || o.name);
    }
  }
  const orgNameByGroupId = (organizationId: string | null): string | null =>
    organizationId ? orgNameById.get(organizationId) ?? null : null;

  const allGroups = [...byId.values()];
  const soloGroups = allGroups.filter((g) => g.group_kind === "one_on_one");
  const socialGroups = allGroups.filter((g) => g.group_kind === "social").sort((a, b) => a.name.localeCompare(b.name));
  const teamGroups = allGroups
    .filter((g) => g.group_kind === "team" || !g.group_kind)
    .sort((a, b) => a.name.localeCompare(b.name));

  // Per-coach tile arrangement + hover-peek defaults (coach_dashboard_
  // redesign_scoping.md's customization layer) — a real DB row, not
  // localStorage, so it follows a coach across devices.
  const { data: layoutRow } = await supabase
    .from("coach_dashboard_layout")
    .select("hidden_tiles, tile_order, tile_metric_overrides")
    .eq("coach_id", user.id)
    .maybeSingle();
  const tileMetricOverrides = (layoutRow?.tile_metric_overrides as Record<string, string>) ?? {};

  // "N — Dual Signal" (coach_dashboard_redesign_scoping.md) — the hero
  // flag/empty-state, per-team-group Team Pulse, stat tiles, today's
  // bookings, and the frequency-normalized quiet-client tiers all come
  // from one batched fetch, kept in its own lib since it's real DB
  // orchestration (untested), pairing with the tested pure logic in
  // lib/team-pulse.ts / lib/quiet-client-tier.ts / lib/coach-hero-priority.ts.
  const dashboardData = await getCoachDashboardData(supabase, {
    coachId: user.id,
    teamGroups: teamGroups.map((g) => ({ id: g.id, name: g.name, orgName: orgNameByGroupId(g.organization_id) })),
    allGroups: allGroups.map((g) => ({ id: g.id, name: g.name, orgName: orgNameByGroupId(g.organization_id) })),
    tileMetricOverrides,
  });

  // "Has something new happened here" dot — same coach_view_state data
  // and same signals (posts since feed_seen_at, workout_logs since
  // clients_seen_at) already driving the sidebar's unread counts inside
  // a group, just collapsed to a boolean for the Home card. A group with
  // no coach_view_state row yet (never visited) gets no dot — nothing to
  // compare against, matching the existing "don't flood on first look"
  // rule the shell's own seeding already follows.
  // AI Assistant Slice 2 ("Collective Intelligence") — today's briefing,
  // if the cron has already run. RLS (coach_briefing_items_select_
  // assigned_or_cascade) already scopes this to athletes this coach
  // actually staffs, so a plain select needs no extra group filtering.
  const todayKey = new Date().toISOString().slice(0, 10);
  const { data: todaysBriefing } = await supabase
    .from("coach_briefings")
    .select("id")
    .eq("coach_id", user.id)
    .eq("briefing_date", todayKey)
    .maybeSingle();
  let collectiveIntelligenceItems: CollectiveIntelligenceItem[] = [];
  if (todaysBriefing) {
    const { data: briefingItemRows } = await supabase
      .from("coach_briefing_items")
      .select("id, item_type, headline, athlete_id, group_id")
      .eq("briefing_id", todaysBriefing.id)
      .order("sort_order", { ascending: true });
    collectiveIntelligenceItems = (briefingItemRows ?? []).map((row) => ({
      id: row.id,
      itemType: row.item_type as CollectiveIntelligenceItem["itemType"],
      headline: row.headline,
      athleteId: row.athlete_id,
      groupId: row.group_id,
    }));
  }

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
      const tier = dashboardData.quietTierByAthlete.get(row.profile_id);
      return {
        groupId: row.group_id,
        athleteId: row.profile_id,
        fullName: profile?.full_name ?? "Client",
        avatarUrl: profile?.avatar_url ?? null,
        lastWorkoutAt: lastLogByAthlete.get(row.profile_id) ?? null,
        hasUnseenActivity: unseenByGroup.get(row.group_id) ?? false,
        quietTier: tier === "mild" || tier === "strong" ? tier : undefined,
        orgName: orgNameByGroupId(byId.get(row.group_id)?.organization_id ?? null),
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
    orgName: orgNameByGroupId(g.organization_id),
  }));
  const socialCards: HomeGroupCardData[] = socialGroups.map((g) => ({
    id: g.id,
    name: g.name,
    focusTag: g.focus_tag,
    memberCount: memberCountByGroup.get(g.id) ?? 0,
    orgName: orgNameByGroupId(g.organization_id),
    hasUnseenActivity: unseenByGroup.get(g.id) ?? false,
  }));

  const orgName = org?.display_name || org?.name || "Your Coaching Business";

  // "N — Dual Signal" (coach_dashboard_redesign_scoping.md): a "Right
  // now" hero beside per-team-group Team Pulse gauges, above a bento
  // grid (stats, Today, This Week, the expandable roster wall). The
  // customization layer (inline word-swap, tile show/hide/reorder,
  // hover-peek) is deliberately not built yet — the doc's own
  // recommended order is static layout, then smart backend (both here),
  // then customization last.
  const content = (
    <>
      <DashboardAutoRefresh />
      <CollectiveIntelligenceChat />
      <div className="flex items-center justify-between mb-6">
        <h1 className="font-display font-bold text-2xl uppercase">Home</h1>
        <MarkAllSeenButton groupIds={allGroupIds} />
      </div>

      <div className="mb-6">
        <DashboardHero flag={dashboardData.heroFlag} emptyState={dashboardData.heroEmptyState} />
      </div>

      {/* Replaces the old team-mode-only Team Pulse side column
          (home_dashboard_merge_and_pulse_tabs_redesign.md) — every
          relationship type gets the same pulse treatment now, not just
          team-kind groups. This also fully covers the roster, so the
          separate "Roster" tile lower on this page (same data,
          collapsed-and-buried) was removed rather than showing the same
          clients/groups twice on one page. */}
      <div className="mb-6">
        <PulseTabs
          clientCards={clientCards}
          teamPulses={dashboardData.teamPulses}
          teamCards={teamCards}
          socialCards={socialCards}
        />
      </div>

      <CollectiveIntelligencePanel items={collectiveIntelligenceItems} hasRunToday={!!todaysBriefing} />

      <NeedsReplyPanel coachId={user.id} threads={needsReplyThreads} />

      <DashboardTileGrid
        initialOrder={(layoutRow?.tile_order as string[] | undefined) ?? []}
        initialHidden={(layoutRow?.hidden_tiles as string[] | undefined) ?? []}
        tiles={[
          {
            key: "stats",
            label: "Stats",
            node: (
              <DashboardStatTiles tiles={dashboardData.statTiles.tiles} initialOverrides={tileMetricOverrides} />
            ),
          },
          {
            key: "week",
            label: "This Week",
            node: <DashboardWeekNarrative text={dashboardData.weekNarrative} />,
          },
          {
            key: "today",
            label: "Today",
            node: <DashboardTodayPanel bookings={dashboardData.todayBookings} />,
          },
        ]}
      />
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
