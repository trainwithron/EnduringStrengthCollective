import { redirect } from "next/navigation";
import { Suspense } from "react";
import { NoAccess } from "@/components/shared/no-access";
import { cookies } from "next/headers";
import { loadStartInputs, parseLastGroupCookie, pickStartGroup } from "@/lib/start-group";
import { createServerClient } from "@/lib/supabase/server";
import { prefersAthleteStyleView, isMobileUserAgent } from "@/lib/pwa-server";
import { CoachHomeShell } from "@/components/coach/coach-home-shell";
import { CoachProfileEditor } from "@/components/coach/coach-profile-editor";
import { CoachDesktopShell } from "@/components/coach/coach-desktop-shell";
import type { HomeClientCardData } from "@/components/coach/desktop/home-client-card";
import type { HomeGroupCardData } from "@/components/coach/desktop/home-group-card";
import { NeedsReplyPanel, type NeedsReplyThread } from "@/components/coach/desktop/needs-reply-panel";
import { OrgNotificationsPanel, type OrgNotification } from "@/components/coach/desktop/org-notifications-panel";
import { MarkAllSeenButton } from "@/components/coach/desktop/mark-all-seen-button";
import { findThreadsNeedingReply } from "@/lib/notification-priority";
import { getCoachedGroups, LAST_WORKSPACE_GROUP_COOKIE } from "@/lib/coach-groups";
import { getActiveAnchor } from "@/lib/active-anchor";
import { orgIsTeamOnly } from "@/lib/team-sport";
import { activeOrgId, clientCountsByOrg, inActiveOrg, rememberedOrgId } from "@/lib/active-org";
import { getCoachDashboardData } from "@/lib/dashboard-data";
import { PulseTabs } from "@/components/coach/desktop/pulse-tabs";
import { DashboardStatTiles } from "@/components/coach/desktop/dashboard-stat-tiles";
import { YourDayPanel } from "@/components/coach/desktop/your-day-panel";
import { attentionFromSources, buildSchedule, type ClassSource } from "@/lib/your-day";
import { DEFAULT_COACH_TIMEZONE, addDaysToKey, dateKeyInZone, localDayBounds } from "@/lib/timezone";
import { isValidTimeZone } from "@/lib/format-in-timezone";
import { isLowReadiness } from "@/lib/wellness";
import { NeedsPaymentPanel } from "@/components/coach/desktop/needs-payment-panel";
import { LateChangesPanel } from "@/components/coach/late-changes-panel";
import { ScheduleRequestsPanel } from "@/components/coach/schedule-requests-panel";
import { LeavingCoachBanner } from "@/components/coach/leaving-coach-banner";
import { TeamCoachHome } from "@/components/coach/team-coach-home";
import { pickTileTeam } from "@/lib/team-coach";
import { loadMyDepartures } from "@/lib/leaving-coach";
import { supportEmail } from "@/lib/legal";
import { ExpiryCheckInPanel } from "@/components/coach/expiry-checkin-panel";
import { InactiveClientsPanel } from "@/components/coach/inactive-clients-panel";
import { ProgressLookPanel } from "@/components/coach/progress-look-panel";
import { DashboardWeekNarrative } from "@/components/coach/desktop/dashboard-week-narrative";
import { DashboardAutoRefresh } from "@/components/coach/desktop/dashboard-auto-refresh";
import { DashboardTileGrid } from "@/components/coach/desktop/dashboard-tile-grid";
import {
  type CollectiveIntelligenceItem,
} from "@/components/coach/desktop/collective-intelligence-panel";
import { StuckDesktopModeBanner } from "@/components/coach/desktop/stuck-desktop-mode-banner";
import { fetchInactiveKeys, inactiveKey } from "@/lib/inactive-ids";
import { readRowsByIds } from "@/lib/read-by-ids";
import { pageAll } from "@/lib/page-all";
import { TerminologyFirstRunCard } from "@/components/coach/desktop/terminology-first-run-card";
import { GettingStartedCard } from "@/components/coach/desktop/getting-started-card";
import { NeedsYouLoader, NeedsYouLoading } from "@/components/coach/desktop/needs-you-loader";

export const metadata = { title: "Home" };

interface GroupRow {
  id: string;
  name: string;
  focus_tag: string | null;
  group_kind: string | null;
  organization_id: string | null;
  archived_at?: string | null;
  team_mode?: boolean | null;
}

export default async function CoachHomePage() {
  const supabase = await createServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect("/login");
  }

  const { data: coachedGroupRows } = await supabase
    .from("group_memberships")
    .select("group_id")
    .eq("profile_id", user.id)
    .eq("role", "coach");

  if (!coachedGroupRows || coachedGroupRows.length === 0) {
    // A coach whose coaching access has ended (their seven days ran out, or they were let go) has no seats left but still needs to see why, and the one export they are owed.
    const ended = (await loadMyDepartures(supabase, user.id)).filter((d) => d.endedAt);
    if (ended.length > 0) {
      return (
        <CoachHomeShell orgName={ended[0].organizationName}>
          <LeavingCoachBanner departures={ended.map((d) => ({ ...d, exportGroupId: null }))} supportEmail={supportEmail()} />
        </CoachHomeShell>
      );
    }
    return (
      <NoAccess>Only coaches have a home dashboard.</NoAccess>
    );
  }

  // /dashboard is a desktop-only surface — the coach mobile app is
  // deliberately minimal (client-facing logging only), and
  // app/login/page.tsx already sends a mobile coach straight to their
  // group hub, never here. But nothing bounced a coach BACK to that same
  // destination if they reached /dashboard some other way (a stale
  // bookmark, an old tab, tapping "Home" in the desktop sidebar's nav
  // while on a phone) — this page had no mobile gate of its own at all,
  // so both possible shells below (CoachDesktopShell and CoachHomeShell)
  // are fixed-width sidebar layouts with zero responsive behavior.
  //
  // MUST use prefersAthleteStyleView() here, matching exactly what
  // app/groups/[groupId]/page.tsx's own showMobileView uses — that page
  // redirects a coach straight back to /dashboard whenever IT decides
  // "not mobile" (its own orphaned-bare-URL fallback). An earlier version
  // of this gate used a real-device-only check that ignores the sticky
  // "Desktop Mode" override, on the theory that /dashboard has no mobile
  // shell to opt into anyway — but that let the two pages disagree for a
  // coach with a stuck desktop override on a real phone: this page would
  // send them to /groups/{id} (real device says mobile), and that page
  // would send them right back here (override says desktop) — an
  // immediate, unrecoverable reload loop, confirmed live in production.
  // Consistency between these two checks matters more than covering this
  // one edge case perfectly; a coach with a stuck override sees the
  // squeezed desktop shell again instead of a loop, which is the correct
  // tradeoff (annoying beats broken).
  if (await prefersAthleteStyleView()) {
    // A phone goes to the coach home of the organization the coach is working IN (the one they chose, or their only one), not to whichever group they joined first: the first group is often another organization's.
    // With several organizations and none chosen it asks, on one plain screen.
    const active = await getActiveAnchor(supabase, user.id);
    if (active?.needsChoice) redirect("/choose-organization?next=/dashboard");
    if (active) redirect(`/groups/${active.anchor.id}`);
    const lastGroupId = parseLastGroupCookie((await cookies()).get("last_group")?.value);
    const start = pickStartGroup(await loadStartInputs(supabase, user.id, lastGroupId));
    redirect(`/groups/${start?.group_id ?? coachedGroupRows[0].group_id}`);
  }

  // Real bug from Ron's own phone, screenshot confirmed: a coach who
  // taps "Desktop Mode" on the mobile Home page gets a sticky
  // view_mode=desktop cookie override (by design — see the block
  // above's own comment on why an explicit override always wins over
  // device detection). On a REAL phone, that means every page on
  // /dashboard renders its full, unresponsive desktop content — no
  // Spot trigger (only CoachMobileShell mounts that), and the one real
  // way back (ExitDesktopModeButton / the rail's own Client-Facing
  // Mode toggle) sits inside chrome that's easy to miss at this exact
  // width (a plain link at the bottom of an otherwise-empty sidebar
  // column, or a rail icon that's itself hidden below lg:). This banner
  // doesn't change any redirect logic (which would risk reintroducing
  // the reload-loop bug documented above) — it's a plain, additional,
  // unmissable render-time notice + one-tap fix shown only when the
  // REAL device is mobile despite the override, so Ron (or anyone else
  // in this spot) sees it immediately instead of hunting for tiny text.
  const stuckInDesktopModeOnRealPhone = await isMobileUserAgent();

  // Home belongs to ONE organization at a time: the one the coach chose with the organization switcher (else their first). Everything on it, and every count, is that
  // organization's; another one appears only after switching to it.
  // The organization they last used (the switcher remembers it); with none remembered, the one with the most clients.
  const rememberedWorkspace = (await cookies()).get(LAST_WORKSPACE_GROUP_COOKIE)?.value ?? null;
  // The briefing is filed under the coach's own day (their time zone, set below), which is the UTC day or a day either side of it: read that window, keep the right one once the zone is known.
  const utcTodayKey = new Date().toISOString().slice(0, 10);
  // Round 1: everything that needs only who the coach is, as one batch.
  const [
    // A coach can own/admin more than one organization (e.g. running several client orgs at once) — fetching every row here, not just
    // one, so Home aggregates groups across ALL of them rather than silently collapsing to just the directly-coached groups the moment
    // there's more than one org membership.
    { data: orgMemberships },
    coachedForOrg,
    { data: viewerProfile },
    { data: coachProfileRow },
    // Has this coach already answered "What do you call your people?" (migration 0336)? Its own select, in this same batch (no extra round), so a database without the column yet leaves the rest
    // of Home alone: an error here means unknown (null), and the card then relies on this browser's memory only.
    askedRead,
    // Separate on purpose: until migration 0249 is applied this select errors and the field is just empty.
    { data: completionMessageRow },
    // Same merge shape GroupSwitcher already uses: every group this coach coaches, plus every group in each org where they're an owner/admin.
    { data: coachedRows },
    // Per-coach tile arrangement + hover-peek defaults — a real DB row, not localStorage, so it follows a coach across devices.
    { data: layoutRow },
    // AI Assistant Slice 2 ("Collective Intelligence") — today's briefing, if the cron has already run. RLS already scopes this to athletes this
    // coach actually staffs, so a plain select needs no extra group filtering.
    { data: briefingWindowRows },
    // Real org-level notifications (trainer-dispatch admin alerts, cascade offers, question replies) are inserted with group_id: null since they're
    // inherently org-wide, not tied to one specific group. This is the one page in the app that's already cross-group by design.
    { data: orgNotificationRows },
  ] = await Promise.all([
    supabase.from("organization_memberships").select("organization_id, role").eq("profile_id", user.id),
    getCoachedGroups(supabase, user.id),
    supabase.from("profiles").select("full_name, timezone").eq("id", user.id).maybeSingle(),
    supabase.from("coach_profiles").select("bio, photo_url").eq("coach_id", user.id).maybeSingle(),
    supabase.from("profiles").select("terminology_asked_at").eq("id", user.id).maybeSingle(),
    supabase.from("coach_profiles").select("completion_message").eq("coach_id", user.id).maybeSingle(),
    supabase.from("group_memberships").select("groups ( id, name, focus_tag, group_kind, organization_id, archived_at, team_mode )").eq("profile_id", user.id).eq("role", "coach"),
    supabase.from("coach_dashboard_layout").select("hidden_tiles, tile_order, tile_metric_overrides").eq("coach_id", user.id).maybeSingle(),
    supabase.from("coach_briefings").select("id, briefing_date").eq("coach_id", user.id).gte("briefing_date", addDaysToKey(utcTodayKey, -1)).lte("briefing_date", addDaysToKey(utcTodayKey, 1)),
    supabase
      .from("notifications")
      .select("id, type, body, link_path, created_at")
      .eq("profile_id", user.id)
      .is("group_id", null)
      .is("read_at", null)
      .order("created_at", { ascending: false })
      .limit(20),
  ]);

  // More than one organization and none remembered: ask which one, rather than guessing the biggest (lib/active-anchor.ts).
  if (!rememberedOrgId(coachedForOrg, rememberedWorkspace) && new Set(coachedForOrg.map((g) => g.orgId)).size > 1) redirect("/choose-organization?next=/dashboard");
  const clientsByOrg = rememberedOrgId(coachedForOrg, rememberedWorkspace) ? {} : await clientCountsByOrg(supabase, coachedForOrg);
  const homeOrgId = activeOrgId(coachedForOrg, rememberedWorkspace, clientsByOrg);
  const primaryOrgMembership = (homeOrgId ? orgMemberships?.find((m) => m.organization_id === homeOrgId) : null) ?? orgMemberships?.[0] ?? null;
  // The coach's own time zone: "today" on this page is their day, not the server's.
  const coachTimezone = isValidTimeZone(viewerProfile?.timezone) ? (viewerProfile!.timezone as string) : DEFAULT_COACH_TIMEZONE;
  const todaysBriefing = (briefingWindowRows ?? []).filter((b) => b.briefing_date === dateKeyInZone(coachTimezone));

  const byId = new Map<string, GroupRow>();
  for (const row of coachedRows ?? []) {
    const g = (row as any).groups as GroupRow | null;
    // a retired season is not one of Home's teams
    if (g && !g.archived_at) byId.set(g.id, g);
  }
  const adminOrgIds = (orgMemberships ?? [])
    .filter((m) => m.role === "owner" || m.role === "admin")
    .map((m) => m.organization_id)
    .filter((id) => !homeOrgId || id === homeOrgId);

  // Round 2: the organization's name, the groups of the organizations they administer, and today's briefing items.
  const [{ data: org }, allGroupRows, { data: briefingItemRows }] = await Promise.all([
    primaryOrgMembership
      ? supabase.from("organizations").select("name, display_name").eq("id", primaryOrgMembership.organization_id).maybeSingle()
      : Promise.resolve({ data: null }),
    // Every group of the organizations they administer (more than 1,000 for a gym with that many one-on-one clients, so a page at a time), by name.
    adminOrgIds.length > 0
      ? pageAll((from, to) => supabase.from("groups").select("id, name, focus_tag, group_kind, organization_id, archived_at, team_mode").in("organization_id", adminOrgIds).order("id").range(from, to)).then((r) => ({
          data: r.rows.sort((a, b) => String(a.name ?? "").localeCompare(String(b.name ?? ""))),
        }))
      : Promise.resolve({ data: null }),
    todaysBriefing && todaysBriefing.length > 0
      ? supabase
          .from("coach_briefing_items")
          .select("id, item_type, headline, athlete_id, group_id")
          .in("briefing_id", todaysBriefing.map((b) => b.id))
          .order("sort_order", { ascending: true })
      : Promise.resolve({ data: null }),
  ]);
  for (const g of allGroupRows.data ?? []) if (!(g as GroupRow).archived_at) byId.set(g.id, g as GroupRow);

  // Only the active organization's groups from here on (the coached groups above may span several organizations).
  for (const g of [...byId.values()]) if (inActiveOrg([g], homeOrgId).length === 0) byId.delete(g.id);

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
  const tileMetricOverrides = (layoutRow?.tile_metric_overrides as Record<string, string>) ?? {};

  let collectiveIntelligenceItems: CollectiveIntelligenceItem[] = (briefingItemRows ?? []).map((row) => ({
    id: row.id,
    itemType: row.item_type as CollectiveIntelligenceItem["itemType"],
    headline: row.headline,
    athleteId: row.athlete_id,
    groupId: row.group_id,
  }));

  const allGroupIds = allGroups.map((g) => g.id);
  // A team organization (every group a team-sport group) has no money on Home: no MRR, income or payments tiles, no needs-payment strip.
  const moneyHidden = orgIsTeamOnly(allGroups);
  // The briefing's items name a group: only this organization's are shown.
  collectiveIntelligenceItems = collectiveIntelligenceItems.filter((i) => !i.groupId || allGroupIds.includes(i.groupId));

  const teamAndSocialIds = [...teamGroups, ...socialGroups].map((g) => g.id);
  const soloGroupIds = soloGroups.map((g) => g.id);
  const day = localDayBounds(coachTimezone);
  const allGroupIdList = allGroups.map((g) => g.id);

  // "Has something new happened here" dot — same coach_view_state data and same signals (posts since feed_seen_at, workout_logs since clients_seen_at)
  // already driving the sidebar's unread counts inside a group, just collapsed to a boolean for the Home card. A group with no coach_view_state row yet
  // (never visited) gets no dot — nothing to compare against.
  async function loadUnseenByGroup(): Promise<Map<string, boolean>> {
    const unseen = new Map<string, boolean>();
    if (allGroupIds.length === 0) return unseen;
    // The database answers "is there anything newer than I last looked" for each visited group (one row per group), instead of this page reading every post and workout ever logged.
    const { rows } = await pageAll((from, to) => supabase.rpc("coach_unseen_groups", { p_group_ids: allGroupIds }).range(from, to));
    for (const row of rows) unseen.set(row.group_id as string, !!row.unseen);
    return unseen;
  }

  // Member counts for team/social group cards.
  async function loadMemberCounts(): Promise<Map<string, number>> {
    const counts = new Map<string, number>();
    if (teamAndSocialIds.length === 0) return counts;
    const { data: memberRows } = await readRowsByIds(teamAndSocialIds, (g) => (from, to) => supabase.from("group_memberships").select("group_id").in("group_id", g).order("id").range(from, to));
    for (const row of memberRows ?? []) {
      counts.set(row.group_id, (counts.get(row.group_id) ?? 0) + 1);
    }
    return counts;
  }

  // "Needs a reply" — the one thing worth surfacing from a big/social group's ordinary feed chatter (per the notification-priority design): a question
  // that's gone unanswered a while. Computed on read from real comment timestamps, no scheduled job. Deliberately excludes 1-on-1 groups — those
  // already get prompt, direct notification on the client's own activity (see complete-workout-button.tsx), not a dashboard staleness check.
  async function loadNeedsReplyThreads(): Promise<NeedsReplyThread[]> {
    if (teamAndSocialIds.length === 0) return [];
    const [{ data: commentRows }, { data: dismissedRows }] = await Promise.all([
      readRowsByIds(teamAndSocialIds, (g) => (from, to) =>
        supabase.from("comments").select("post_id, group_id, author_id, created_at, body, profiles ( full_name )").in("group_id", g).order("id").range(from, to)
      ),
      supabase.from("coach_dismissed_reply_alerts").select("post_id, dismissed_at").eq("coach_id", user!.id),
    ]);

    const dismissedAt = new Map((dismissedRows ?? []).map((d) => [d.post_id, d.dismissed_at]));

    const stale = findThreadsNeedingReply(
      (commentRows ?? []).map((c) => ({
        postId: c.post_id,
        groupId: c.group_id,
        authorId: c.author_id,
        createdAt: c.created_at,
      })),
      user!.id,
      new Date(),
      8,
      dismissedAt
    );
    if (stale.length === 0) return [];

    const postIds = stale.map((t) => t.postId);
    const { data: postRows } = await supabase.from("posts").select("id, channel").in("id", postIds);
    const channelByPostId = new Map((postRows ?? []).map((p) => [p.id, p.channel]));

    // The exact comment row behind each stale thread — same (postId, createdAt) pair findThreadsNeedingReply already picked as "the latest" — so the
    // alert can show who said what, not just a count.
    const commentByKey = new Map((commentRows ?? []).map((c) => [`${c.post_id}:${c.created_at}`, c]));

    const nameByGroupId = new Map([...teamGroups, ...socialGroups].map((g) => [g.id, g.name]));
    return stale.map((t) => {
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

  // A 1-on-1 client's group has exactly one athlete member — fetch that member's profile plus their most recent workout_logs entry, same
  // lastLogByAthlete pattern already used on the Clients roster page.
  async function loadSoloClientRows() {
    if (soloGroupIds.length === 0) return null;
    const [{ data: athleteRows }, { data: recentLogs }, inactiveKeys] = await Promise.all([
      readRowsByIds(soloGroupIds, (g) => (from, to) =>
        supabase.from("group_memberships").select("group_id, profile_id, profiles ( full_name, avatar_url )").in("group_id", g).eq("role", "athlete").order("id").range(from, to)
      ),
      // The last workout of each client, worked out by the database (one row per client).
      pageAll((from, to) => supabase.rpc("business_last_active", { p_group_ids: soloGroupIds }).range(from, to)).then((r) => {
        // A failed read must not look like "no client has ever worked out".
        if (r.failed) throw new Error("Could not read the clients' last workouts.");
        return { data: r.rows.map((x: any) => ({ athlete_id: x.athlete_id, created_at: x.last_at })) };
      }),
      fetchInactiveKeys(supabase, soloGroupIds),
    ]);
    return { athleteRows, recentLogs, inactiveKeys };
  }

  // Your day: today's classes (the 1-on-1 sessions are already in dashboardData). Any failure (or the group-sessions migration not applied yet)
  // just leaves that part out.
  async function loadTodaysClasses(): Promise<ClassSource[]> {
    try {
      const { data: classData } = await readRowsByIds(allGroupIdList, (g) => (from, to) =>
        supabase
          .from("group_sessions")
          .select("id, title, start_at, end_at, capacity")
          .eq("kind", "class")
          .eq("coach_id", user!.id)
          .in("group_id", g)
          .eq("status", "scheduled")
          .gte("start_at", day.startIso)
          .lt("start_at", day.endIso)
          .order("id")
          .range(from, to)
      );
      const classRows = classData.sort((a, b) => String(a.start_at).localeCompare(String(b.start_at)));
      const ids = (classRows ?? []).map((c: any) => c.id as string);
      const counts = new Map<string, { joined: number; waitlisted: number }>();
      if (ids.length > 0) {
        const { data: countRows } = await supabase.rpc("group_session_counts", { p_session_ids: ids });
        for (const c of (countRows ?? []) as any[]) counts.set(c.session_id, { joined: c.joined, waitlisted: c.waitlisted });
      }
      // The classes page lives under a group the coach coaches; any one of them opens it.
      const classesGroupId = (allGroups.find((g) => g.group_kind !== "one_on_one") ?? allGroups[0])?.id;
      if (!classesGroupId) return [];
      return (classRows ?? []).map((c: any) => ({
        id: c.id,
        title: c.title,
        startAt: c.start_at,
        endAt: c.end_at,
        capacity: c.capacity,
        joined: counts.get(c.id)?.joined ?? 0,
        waitlisted: counts.get(c.id)?.waitlisted ?? 0,
        groupId: classesGroupId,
      }));
    } catch {
      return [];
    }
  }

  // Low-readiness check-ins from today. Any failure just leaves that part out.
  async function loadLowReadiness(): Promise<{ athleteId: string; groupId: string; name: string }[]> {
    try {
      if (allGroupIdList.length === 0) return [];
      const { data: wellnessRows } = await readRowsByIds(allGroupIdList, (g) => (from, to) =>
        supabase.from("wellness_checkins").select("athlete_id, group_id, sleep_quality, soreness, energy").in("group_id", g).eq("log_date", day.dateKey).order("id").range(from, to)
      );
      const low = (wellnessRows ?? []).filter((w: any) => isLowReadiness({ sleepQuality: w.sleep_quality, soreness: w.soreness, energy: w.energy }));
      if (low.length === 0) return [];
      const { data: nameRows } = await readRowsByIds(low.map((w: any) => w.athlete_id as string), (g) => (from, to) => supabase.from("profiles").select("id, full_name").in("id", g).order("id").range(from, to));
      const nameById = new Map((nameRows ?? []).map((p: any) => [p.id, p.full_name as string]));
      return low.map((w: any) => ({ athleteId: w.athlete_id, groupId: w.group_id, name: nameById.get(w.athlete_id) ?? "A client" }));
    } catch {
      return [];
    }
  }

  // Round 3: everything left reads only the group list, so it all runs as one batch (the "N — Dual Signal" dashboard data — hero flag/empty-state,
  // per-team-group Team Pulse, stat tiles, today's bookings, quiet-client tiers — comes from one batched fetch in its own lib).
  const [dashboardData, unseenByGroup, memberCountByGroup, needsReplyThreads, soloRows, todaysClasses, lowReadiness] = await Promise.all([
    getCoachDashboardData(supabase, {
      coachId: user.id,
      teamGroups: teamGroups.map((g) => ({ id: g.id, name: g.name, orgName: orgNameByGroupId(g.organization_id) })),
      allGroups: allGroups.map((g) => ({ id: g.id, name: g.name, orgName: orgNameByGroupId(g.organization_id) })),
      tileMetricOverrides,
      timezone: coachTimezone,
      coachProfileTimezone: isValidTimeZone(viewerProfile?.timezone) ? (viewerProfile!.timezone as string) : null,
    }),
    loadUnseenByGroup(),
    loadMemberCounts(),
    loadNeedsReplyThreads(),
    loadSoloClientRows(),
    loadTodaysClasses(),
    loadLowReadiness(),
  ]);

  const orgNotifications: OrgNotification[] = (orgNotificationRows ?? []).map((n) => ({
    id: n.id,
    type: n.type,
    body: n.body,
    linkPath: n.link_path,
    createdAt: n.created_at,
  }));

  let clientCards: HomeClientCardData[] = [];
  if (soloRows) {
    const { athleteRows, recentLogs, inactiveKeys } = soloRows;
    const lastLogByAthlete = new Map<string, string>();
    for (const log of recentLogs ?? []) {
      if (!lastLogByAthlete.has(log.athlete_id)) {
        lastLogByAthlete.set(log.athlete_id, log.created_at);
      }
    }

    clientCards = (athleteRows ?? [])
      .filter((row) => !inactiveKeys.has(inactiveKey(row.group_id, row.profile_id)))
      .map((row) => {
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

  const yourDaySchedule = buildSchedule(user.id, dashboardData.todayBookings, todaysClasses);
  const yourDayAttention = attentionFromSources({
    replies: needsReplyThreads,
    payments: dashboardData.needsPayment,
    readiness: lowReadiness,
    insights: collectiveIntelligenceItems.filter((i) => i.itemType !== "celebration").map((i) => ({ id: i.id, headline: i.headline, athleteId: i.athleteId, groupId: i.groupId })),
    notices: orgNotifications.map((n) => ({ id: n.id, body: n.body, linkPath: n.linkPath, createdAt: n.createdAt })),
  });

  // "Needs you": built from what is already loaded above plus a few small soft reads, which load behind a Suspense (NeedsYouLoader) so the rest of Home does not wait for them.
  const needsYouInput = {
    coachId: user.id,
    timezone: coachTimezone,
    now: new Date(),
    groupIds: allGroupIdList,
    todayBookings: dashboardData.todayBookings,
    needsPayment: dashboardData.needsPayment,
    lowReadiness,
    quietTierByAthlete: dashboardData.quietTierByAthlete,
    needsReplyThreads,
    heroFlag: dashboardData.heroFlag,
  };

  // "N — Dual Signal" (coach_dashboard_redesign_scoping.md): a "Right
  // now" hero beside per-team-group Team Pulse gauges, above a bento
  // grid (stats, Today, This Week, the expandable roster wall). The
  // customization layer (inline word-swap, tile show/hide/reorder,
  // hover-peek) is deliberately not built yet — the doc's own
  // recommended order is static layout, then smart backend (both here),
  // then customization last.
  // One section per organization they are leaving, each exporting THAT organization (from their own coached groups, which are read before the page is narrowed to the active organization).
  // A coach who said they coach a team gets the team tiles on top of Home (lib/team-coach.ts). A failed read just means the usual Home.
  let isTeamCoach = false;
  try {
    const { data: typeRow } = await supabase.from("profiles").select("coach_type").eq("id", user.id).maybeSingle();
    isTeamCoach = (typeRow as { coach_type?: string | null } | null)?.coach_type === "team";
  } catch {
    isTeamCoach = false;
  }
  // The teams the tiles are for: only teams this coach really coaches (getCoachedGroups leaves retired seasons out), in the organization Home is showing, the one they last worked in first.
  const tileTeams = coachedForOrg.filter((g) => g.kind === "team" && (!homeOrgId || g.orgId === homeOrgId)).map((g) => ({ id: g.id, name: g.name }));
  const tileTeam = pickTileTeam(tileTeams, rememberedWorkspace);
  const departures = await loadMyDepartures(supabase, user.id);
  const myCoachedGroups = (coachedRows ?? []).map((row) => (row as any).groups as GroupRow | null).filter((g): g is GroupRow => !!g);
  const departuresWithExport = departures.map((d) => ({ ...d, exportGroupId: myCoachedGroups.find((g) => g.organization_id === d.organizationId)?.id ?? null }));
  const content = (
    <>
      <DashboardAutoRefresh />
      {stuckInDesktopModeOnRealPhone && <StuckDesktopModeBanner />}
      <LeavingCoachBanner departures={departuresWithExport} supportEmail={supportEmail()} />
      {isTeamCoach && tileTeams.length > 0 && tileTeam && <TeamCoachHome teams={tileTeams} initialId={tileTeam.id} />}
      <CoachProfileEditor
        coachId={user.id}
        coachName={viewerProfile?.full_name ?? "Coach"}
        initialBio={coachProfileRow?.bio ?? null}
        initialPhotoUrl={coachProfileRow?.photo_url ?? null}
        initialCompletionMessage={completionMessageRow?.completion_message ?? null}
      />
      <div className="flex items-center justify-between mb-6">
        <h1 className="font-display font-bold text-2xl uppercase">Home</h1>
        <MarkAllSeenButton groupIds={allGroupIds} />
      </div>

      {allGroups[0] && <TerminologyFirstRunCard groupId={allGroups[0].id} askedOnServer={askedRead.error ? null : !!(askedRead.data as { terminology_asked_at?: string | null } | null)?.terminology_asked_at} />}

      {!moneyHidden && clientCards.length === 0 && teamCards.length === 0 && socialCards.length === 0 && allGroups[0] && (
        <GettingStartedCard groupId={(allGroups.find((g) => g.group_kind !== "one_on_one") ?? allGroups[0]).id} />
      )}

      <Suspense fallback={<NeedsYouLoading />}>
        <NeedsYouLoader input={needsYouInput} />
      </Suspense>

      <YourDayPanel schedule={yourDaySchedule} attention={yourDayAttention} timezone={coachTimezone} showPayments={!moneyHidden} />

      {/* Replaces the old team-mode-only Team Pulse side column
          (home_dashboard_merge_and_pulse_tabs_redesign.md) — every
          relationship type gets the same pulse treatment now, not just
          team-kind groups. This also fully covers the roster, so the
          separate "Roster" tile lower on this page (same data,
          collapsed-and-buried) was removed rather than showing the same
          clients/groups twice on one page. */}
      {/* A team organization has its team tiles above; the 1-on-1 / athlete / group pulse tabs, the athlete counts and the "invite your first client" lines are for coaches who sell to clients. */}
      {!moneyHidden && (
        <div className="mb-6">
          <PulseTabs
            clientCards={clientCards}
            teamPulses={dashboardData.teamPulses}
            teamCards={teamCards}
            socialCards={socialCards}
          />
        </div>
      )}

      {/* The stack below is what the strip's "N more" opens; the strip's buttons also jump to the panel that handles the request. Nothing in it changed. */}
      <div id="needs-stack">
        <OrgNotificationsPanel initialNotifications={orgNotifications} />

        <NeedsReplyPanel coachId={user.id} threads={needsReplyThreads} />

        <div id="late-changes">
          <LateChangesPanel groupIds={allGroupIds} />
        </div>
        <div id="schedule-requests">
          <ScheduleRequestsPanel groupIds={allGroupIds} />
        </div>
        <div id="expiring">
          <ExpiryCheckInPanel groupIds={allGroupIds} />
        </div>
        <InactiveClientsPanel groupIds={allGroupIds} />
        <ProgressLookPanel groupIds={allGroupIds} />
        {!moneyHidden && <NeedsPaymentPanel rows={dashboardData.needsPayment} />}
      </div>

      {!moneyHidden && (
      <DashboardTileGrid
        initialOrder={(layoutRow?.tile_order as string[] | undefined) ?? []}
        initialHidden={(layoutRow?.hidden_tiles as string[] | undefined) ?? []}
        tiles={[
          {
            key: "stats",
            label: "Stats",
            node: (
              <DashboardStatTiles tiles={moneyHidden ? dashboardData.statTiles.tiles.filter((x) => x.key !== "mrr" && x.key !== "income") : dashboardData.statTiles.tiles} initialOverrides={tileMetricOverrides} />
            ),
          },
          {
            key: "week",
            label: "This Week",
            node: <DashboardWeekNarrative text={dashboardData.weekNarrative} />,
          },
        ]}
      />
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
  //
  // Explicitly excludes one-on-one groups — a real bug Ron hit live: a
  // 1-on-1 client's relationship IS a groups row named after them
  // (stale_client_name_header_bug.md's own root cause), so a coach whose
  // last stop before Home was a client's profile fed that client's own
  // identity into CoachDesktopShell here — which, correctly for every
  // OTHER one of its 32 call sites, rendered the "you're in {client}'s
  // workspace" banner AND the "{client} [Client]" breadcrumb chip
  // directly over Home's real cross-org dashboard. Home is never
  // single-group-scoped by design, so it should never inherit a client's
  // identity at all — falling back to the minimal CoachHomeShell (same
  // as the "no last_group cookie yet" case) is the correct behavior here,
  // not a degraded one.
  // Home never reads the last_group cookie: whatever the coach last visited, Home shows the same coach-level rail. It is anchored on the coach's
  // first team or social group by name (below), or on a one-on-one group when that is all they have; the anchor only decides where the rail's
  // links point, never what it shows.
  let lastGroup: { id: string; name: string } | null = null;

  // Anchor Home's rail on the coach's first team or social group (by name), so the full coach-level rail
  // is always there. Home is the coach's own page, so it shows the business name and never a group or client identity (coachLevel).
  if (!lastGroup) {
    const firstSharedGroup = [...allGroups]
      .filter((g) => g.group_kind !== "one_on_one")
      .sort((a, b) => String(a.name ?? "").localeCompare(String(b.name ?? "")))[0];
    if (firstSharedGroup) lastGroup = { id: firstSharedGroup.id, name: firstSharedGroup.name ?? "Group" };
  }

  if (lastGroup) {
    return (
      <CoachDesktopShell groupId={lastGroup.id} groupName={lastGroup.name} active="home" coachLevel>
        {content}
      </CoachDesktopShell>
    );
  }

  // A coach whose groups are all one-on-one: anchor on one of them, still coach-level (no client identity shown).
  const anySoloGroup = allGroups[0];
  if (anySoloGroup) {
    return (
      <CoachDesktopShell groupId={anySoloGroup.id} groupName={orgName} active="home" coachLevel>
        {content}
      </CoachDesktopShell>
    );
  }

  return <CoachHomeShell orgName={orgName}>{content}</CoachHomeShell>;
}
