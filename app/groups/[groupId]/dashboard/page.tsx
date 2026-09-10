import Link from "next/link";
import { redirect } from "next/navigation";
import { createServerClient } from "@/lib/supabase/server";
import { CoachDesktopShell } from "@/components/coach/coach-desktop-shell";
import { computeScheduledDates } from "@/lib/program-schedule";
import {
  computeProgramEndingSuggestions,
  computeMacrosMissingSuggestions,
  computeSuggestedReminderDate,
  type AthleteProgramInfo,
  type AthleteMacroInfo,
  type ReminderRule,
} from "@/lib/coaching-suggestions";
import { SuggestionSettings } from "@/components/coach/desktop/suggestion-settings";
import { NeedsAttentionPanel, type NeedsAttentionItem } from "@/components/coach/desktop/needs-attention-panel";
import { WorkoutSummaryCard } from "@/components/feed/workout-summary-card";
import type { FeedPost } from "@/lib/types";

function dateKey(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(
    d.getDate()
  ).padStart(2, "0")}`;
}

interface ActivityItem {
  id: string;
  type: "booking" | "comment";
  createdAt: string;
  groupName: string;
  text: string;
}

type TimelineEntry =
  | { kind: "post"; createdAt: string; post: FeedPost; groupName: string; sessionId: string | null }
  | { kind: "text"; createdAt: string; item: ActivityItem };

function timeAgo(iso: string): string {
  const diffMs = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(diffMs / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}

export default async function CoachDashboardPage(
  props: {
    params: Promise<{ groupId: string }>;
    searchParams: Promise<{ scope?: string }>;
  }
) {
  const params = await props.params;
  const searchParams = await props.searchParams;
  const scopeAll = searchParams.scope === "all";
  const supabase = await createServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) redirect("/login");

  const { data: membership } = await supabase
    .from("group_memberships")
    .select("role")
    .eq("group_id", params.groupId)
    .eq("profile_id", user.id)
    .maybeSingle();

  if (membership?.role !== "coach") {
    return (
      <main className="min-h-screen bg-graphite text-chalk flex items-center justify-center px-6">
        <p className="font-body text-steel text-center">Only coaches can view the dashboard.</p>
      </main>
    );
  }

  const { data: group } = await supabase
    .from("groups")
    .select("name")
    .eq("id", params.groupId)
    .single();

  // Every group this coach moderates — fetched either way so the scope
  // toggle below always knows how many groups exist, but only actually
  // used for cross-group activity when the coach explicitly asks for it
  // (?scope=all). Defaults to just the group currently open, matching
  // every other page in the app — a coach running visually distinct
  // groups (e.g. a bodybuilding group vs. a 60+ group) doesn't want one
  // group's activity bleeding into the other's dashboard by default.
  const { data: coachedGroups } = await supabase
    .from("group_memberships")
    .select("group_id, groups ( name )")
    .eq("profile_id", user.id)
    .eq("role", "coach");

  const allGroupIds = (coachedGroups ?? []).map((g: any) => g.group_id);
  const groupIds = scopeAll ? allGroupIds : [params.groupId];
  const groupNameById = new Map<string, string>(
    (coachedGroups ?? []).map((g: any) => [g.group_id, g.groups?.name ?? "Group"])
  );

  const ACTIVITY_LIMIT = 15;
  const items: ActivityItem[] = [];
  const timeline: TimelineEntry[] = [];

  if (groupIds.length > 0) {
    // Real Team Feed posts (post_type='workout_summary'), across every
    // group this coach runs — rendered with the exact same interactive
    // card (like/comment) Team Feed itself uses, not a plain text
    // summary, per the ask to be able to react/comment right from here
    // instead of sending a DM.
    const { data: workoutPosts } = await supabase
      .from("posts")
      .select(
        `
        id, post_type, channel, pinned_at, body, media_url, media_type, created_at, group_id, broadcast_level,
        profiles!posts_author_id_fkey ( id, full_name, avatar_url ),
        workout_logs ( session_id, total_volume, total_sets_completed, new_prs, logged_by_coach ),
        reactions ( profile_id ),
        comments ( id )
      `
      )
      .eq("post_type", "workout_summary")
      .in("group_id", groupIds)
      .order("created_at", { ascending: false })
      .limit(ACTIVITY_LIMIT);

    for (const p of (workoutPosts ?? []) as any[]) {
      const post: FeedPost = {
        id: p.id,
        groupId: p.group_id,
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
        viewerHasReacted: (p.reactions ?? []).some((r: any) => r.profile_id === user.id),
        commentCount: p.comments?.length ?? 0,
      };
      timeline.push({
        kind: "post",
        createdAt: p.created_at,
        post,
        groupName: groupNameById.get(p.group_id) ?? "Group",
        sessionId: p.workout_logs?.session_id ?? null,
      });
    }

    const { data: comments } = await supabase
      .from("comments")
      .select("id, group_id, created_at, body, profiles ( full_name )")
      .in("group_id", groupIds)
      .order("created_at", { ascending: false })
      .limit(ACTIVITY_LIMIT);

    for (const c of (comments ?? []) as any[]) {
      items.push({
        id: `comment-${c.id}`,
        type: "comment",
        createdAt: c.created_at,
        groupName: groupNameById.get(c.group_id) ?? "Group",
        text: `${c.profiles?.full_name ?? "Someone"} commented: "${(c.body ?? "").slice(0, 80)}${
          (c.body ?? "").length > 80 ? "…" : ""
        }"`,
      });
    }
  }

  // Sessions this coach has booked, scoped the same way as everything
  // else on this page — the closest thing to a "transaction" this app
  // actually has (there's no real payment system; session credits are a
  // manual coach-set counter).
  const { data: bookings } = await supabase
    .from("bookings")
    .select("id, group_id, created_at, start_at, status, profiles!bookings_athlete_id_fkey ( full_name )")
    .eq("coach_id", user.id)
    .in("group_id", groupIds)
    .order("created_at", { ascending: false })
    .limit(ACTIVITY_LIMIT);

  for (const b of (bookings ?? []) as any[]) {
    const when = new Date(b.start_at).toLocaleDateString("en-US", { month: "short", day: "numeric" });
    items.push({
      id: `booking-${b.id}`,
      type: "booking",
      createdAt: b.created_at,
      groupName: groupNameById.get(b.group_id) ?? "Group",
      text:
        b.status === "cancelled"
          ? `${b.profiles?.full_name ?? "A client"} cancelled their session on ${when}`
          : `${b.profiles?.full_name ?? "A client"} booked a session on ${when}`,
    });
  }

  for (const item of items) {
    timeline.push({ kind: "text", createdAt: item.createdAt, item });
  }

  timeline.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
  const recentActivity = timeline.slice(0, 25);

  // "Needs attention": athletes whose active program is about to run out
  // with nothing lined up after it. Computed fresh from each group's real
  // program schedule, not stored — same read-time-derivation approach as
  // everywhere else this app computes calendar dates.
  const { data: prefsRow } = await supabase
    .from("coach_preferences")
    .select("suggestion_mode, suggestion_lead_days, suggestion_lead_mode, suggestion_lead_weekday")
    .eq("coach_id", user.id)
    .maybeSingle();

  const suggestionMode = (prefsRow?.suggestion_mode ?? "list") as "list" | "auto_add";
  const suggestionLeadDays = prefsRow?.suggestion_lead_days ?? 3;
  const suggestionLeadMode = (prefsRow?.suggestion_lead_mode ?? "days_before") as "days_before" | "weekday_before";
  const suggestionLeadWeekday = prefsRow?.suggestion_lead_weekday ?? 5;
  const reminderRule: ReminderRule =
    suggestionLeadMode === "weekday_before"
      ? { mode: "weekday_before", weekday: suggestionLeadWeekday }
      : { mode: "days_before", days: suggestionLeadDays };

  const today = new Date();

  // Every athlete across every group this coach runs, once — reused below
  // for both suggestion types instead of re-querying per check.
  const { data: allAthleteRows } =
    groupIds.length > 0
      ? await supabase
          .from("group_memberships")
          .select("profile_id, group_id, client_tier, profiles ( full_name )")
          .in("group_id", groupIds)
          .eq("role", "athlete")
      : { data: [] };

  const allAthletes = (allAthleteRows ?? []).map((a: any) => ({
    athleteId: a.profile_id as string,
    athleteName: (a.profiles?.full_name ?? "A client") as string,
    groupId: a.group_id as string,
    groupName: groupNameById.get(a.group_id) ?? "Group",
    clientTier: a.client_tier as "one_on_one" | "online" | "group" | null,
  }));

  const athleteInfos: AthleteProgramInfo[] = [];

  for (const groupId of groupIds) {
    const { data: activeProgram } = await supabase
      .from("programs")
      .select("id, start_date, training_days")
      .eq("group_id", groupId)
      .eq("is_active", true)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    if (!activeProgram?.start_date || !activeProgram.training_days?.length) continue;

    const { data: workoutRows } = await supabase
      .from("workouts")
      .select("id")
      .eq("program_id", activeProgram.id)
      .order("week_number", { ascending: true })
      .order("day_index", { ascending: true });

    if (!workoutRows || workoutRows.length === 0) continue;

    const scheduleMap = computeScheduledDates(
      activeProgram.start_date,
      activeProgram.training_days,
      workoutRows
    );
    const dates = Array.from(scheduleMap.values());
    if (dates.length === 0) continue;
    const programEndDate = new Date(Math.max(...dates.map((d) => d.getTime())));

    for (const a of allAthletes.filter((a) => a.groupId === groupId)) {
      athleteInfos.push({ ...a, programEndDate });
    }
  }

  const rawSuggestions = computeProgramEndingSuggestions(athleteInfos, today, reminderRule);

  // Macro suggestions: does each (non-group-tier) athlete have any macro
  // target set for the coming week?
  const nextWeekStart = new Date(today);
  nextWeekStart.setDate(today.getDate() + 1);
  const nextWeekEnd = new Date(today);
  nextWeekEnd.setDate(today.getDate() + 7);
  const macroEligibleAthletes = allAthletes.filter((a) => a.clientTier !== "group");
  const macroEligibleIds = macroEligibleAthletes.map((a) => a.athleteId);

  const { data: macroRows } =
    macroEligibleIds.length > 0
      ? await supabase
          .from("daily_macros")
          .select("athlete_id, log_date")
          .in("athlete_id", macroEligibleIds)
          .gte("log_date", dateKey(nextWeekStart))
          .lte("log_date", dateKey(nextWeekEnd))
          .not("calories", "is", null)
      : { data: [] };

  const macroDaysCountByAthlete = new Map<string, number>();
  for (const row of macroRows ?? []) {
    macroDaysCountByAthlete.set(row.athlete_id, (macroDaysCountByAthlete.get(row.athlete_id) ?? 0) + 1);
  }

  const macroInfos: AthleteMacroInfo[] = macroEligibleAthletes.map((a) => ({
    ...a,
    daysWithMacrosNextWeek: macroDaysCountByAthlete.get(a.athleteId) ?? 0,
  }));

  const rawMacroSuggestions = computeMacrosMissingSuggestions(macroInfos);

  // Dedupe against anything already on the calendar for this athlete, per
  // suggestion kind (an athlete can legitimately have both a "program
  // ending" and a "macros missing" suggestion active at once, each with
  // its own independent handled/dismissed state) — a dedicated
  // trigger_key column distinguishes the two, backed by a real unique
  // index (coach_id, linked_athlete_id, trigger_key) rather than a
  // fragile title substring.
  const athleteIdsInPlay = Array.from(
    new Set([...rawSuggestions.map((s) => s.athleteId), ...rawMacroSuggestions.map((s) => s.athleteId)])
  );
  const { data: existingSuggestionEvents } =
    athleteIdsInPlay.length > 0
      ? await supabase
          .from("calendar_events")
          .select("linked_athlete_id, trigger_key")
          .eq("coach_id", user.id)
          .eq("event_type", "suggestion")
          .in("linked_athlete_id", athleteIdsInPlay)
      : { data: [] };

  const programEndingHandled = new Set(
    (existingSuggestionEvents ?? [])
      .filter((r) => r.trigger_key === "program_ending")
      .map((r) => r.linked_athlete_id)
  );
  const macrosHandled = new Set(
    (existingSuggestionEvents ?? [])
      .filter((r) => r.trigger_key === "macros_missing")
      .map((r) => r.linked_athlete_id)
  );

  const activeSuggestions = rawSuggestions.filter((s) => !programEndingHandled.has(s.athleteId));
  const activeMacroSuggestions = rawMacroSuggestions.filter((s) => !macrosHandled.has(s.athleteId));

  const needsAttentionItems: NeedsAttentionItem[] = [];

  for (const s of activeSuggestions) {
    const suggestedDate = computeSuggestedReminderDate(s.programEndDate, reminderRule, today);
    const suggestedDateKey = dateKey(suggestedDate);

    if (suggestionMode === "auto_add") {
      // Upsert with ignoreDuplicates, not insert — the unique index on
      // (coach_id, linked_athlete_id, trigger_key) makes this atomic, so
      // two concurrent page loads can't both create a row the way a
      // plain check-then-insert could.
      await supabase.from("calendar_events").upsert(
        {
          coach_id: user.id,
          title: s.title,
          event_date: suggestedDateKey,
          event_type: "suggestion",
          trigger_key: "program_ending",
          linked_athlete_id: s.athleteId,
          linked_group_id: s.groupId,
          status: "active",
        },
        { onConflict: "coach_id,linked_athlete_id,trigger_key", ignoreDuplicates: true }
      );
    }

    needsAttentionItems.push({
      athleteId: s.athleteId,
      groupId: s.groupId,
      title: s.title,
      triggerKey: "program_ending",
      suggestedDateKey,
      alreadyOnCalendar: suggestionMode === "auto_add",
    });
  }

  // Macro suggestions land today by default (no lead-day math the way
  // program-ending has an actual deadline to count back from — "next
  // week has nothing set" is actionable any day).
  for (const s of activeMacroSuggestions) {
    const suggestedDateKey = dateKey(today);

    if (suggestionMode === "auto_add") {
      await supabase.from("calendar_events").upsert(
        {
          coach_id: user.id,
          title: s.title,
          event_date: suggestedDateKey,
          event_type: "suggestion",
          trigger_key: "macros_missing",
          linked_athlete_id: s.athleteId,
          linked_group_id: s.groupId,
          status: "active",
        },
        { onConflict: "coach_id,linked_athlete_id,trigger_key", ignoreDuplicates: true }
      );
    }

    needsAttentionItems.push({
      athleteId: s.athleteId,
      groupId: s.groupId,
      title: s.title,
      triggerKey: "macros_missing",
      suggestedDateKey,
      alreadyOnCalendar: suggestionMode === "auto_add",
    });
  }

  const TYPE_LABEL: Record<ActivityItem["type"], string> = {
    comment: "Comment",
    booking: "Session",
  };

  return (
    <CoachDesktopShell groupId={params.groupId} groupName={group?.name ?? "Coaching"} active="dashboard">
      <div className="pb-6 border-b border-steel/20 mb-6 flex items-start justify-between gap-4">
        <div>
          <h1 className="font-display font-bold text-3xl uppercase leading-none">Dashboard</h1>
          <p className="font-body text-sm text-steel mt-2 max-w-[70ch]">
            {scopeAll
              ? `Recent activity across every group you coach (${allGroupIds.length} groups)`
              : "Recent activity in this group"}{" "}
            — completed workouts, new comments, and booked sessions.
          </p>
        </div>
        {allGroupIds.length > 1 && (
          <div className="flex gap-2 shrink-0">
            <Link
              href={`/groups/${params.groupId}/dashboard`}
              className={`h-8 px-3 flex items-center font-body text-xs border ${
                !scopeAll ? "bg-rust text-graphite border-rust" : "border-steel/30 text-steel"
              }`}
            >
              This group
            </Link>
            <Link
              href={`/groups/${params.groupId}/dashboard?scope=all`}
              className={`h-8 px-3 flex items-center font-body text-xs border ${
                scopeAll ? "bg-rust text-graphite border-rust" : "border-steel/30 text-steel"
              }`}
            >
              All groups
            </Link>
          </div>
        )}
      </div>

      <SuggestionSettings
        coachId={user.id}
        initialMode={suggestionMode}
        initialLeadDays={suggestionLeadDays}
        initialLeadMode={suggestionLeadMode}
        initialLeadWeekday={suggestionLeadWeekday}
      />

      <NeedsAttentionPanel coachId={user.id} items={needsAttentionItems} />

      <h2 className="font-display uppercase text-sm tracking-wide text-steel mb-2">
        Recent activity
      </h2>

      {recentActivity.length === 0 ? (
        <p className="font-body text-sm text-steel py-6">Nothing yet — activity will show up here.</p>
      ) : (
        <div className="divide-y divide-steel/15 max-w-2xl border border-steel/15">
          {recentActivity.map((entry) =>
            entry.kind === "post" ? (
              <div key={`post-${entry.post.id}`} className="relative">
                <span className="absolute top-4 right-5 font-body text-[10px] text-steel">
                  {entry.groupName}
                </span>
                <WorkoutSummaryCard post={entry.post} viewerId={user.id} isCoach />
                {entry.sessionId && (
                  <Link
                    href={`/sessions/${entry.sessionId}`}
                    className="block px-5 pb-3 -mt-2 font-body text-xs text-rust"
                  >
                    View full session log (every set, rep, weight &amp; note) &rarr;
                  </Link>
                )}
              </div>
            ) : (
              <div key={entry.item.id} className="py-3 px-5 flex items-start gap-3">
                <span className="font-body text-[10px] text-steel uppercase tracking-wide border border-steel/30 px-1.5 py-0.5 shrink-0 mt-0.5">
                  {TYPE_LABEL[entry.item.type]}
                </span>
                <div className="min-w-0 flex-1">
                  <p className="font-body text-sm">{entry.item.text}</p>
                  <p className="font-body text-xs text-steel mt-0.5">
                    {entry.item.groupName} &middot; {timeAgo(entry.item.createdAt)}
                  </p>
                </div>
              </div>
            )
          )}
        </div>
      )}
    </CoachDesktopShell>
  );
}
