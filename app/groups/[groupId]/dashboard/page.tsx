import Link from "next/link";
import { redirect } from "next/navigation";
import { createServerClient } from "@/lib/supabase/server";
import { CoachDesktopShell } from "@/components/coach/coach-desktop-shell";
import { getNeedsAttentionItems } from "@/lib/needs-attention-data";
import { SuggestionSettings } from "@/components/coach/desktop/suggestion-settings";
import { NeedsAttentionPanel } from "@/components/coach/desktop/needs-attention-panel";
import { RosterSection } from "@/components/coach/desktop/roster-section";
import { AddClientButton } from "@/components/coach/desktop/add-client-button";
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
  // with nothing lined up after it, or has no macros set for next week.
  // Extracted into lib/needs-attention-data.ts so the coach-desktop-shell's
  // pinned strip can reuse the exact same computation.
  const needsAttentionItems = await getNeedsAttentionItems(supabase, { coachId: user.id, groupIds });

  // Re-fetched here (a cheap single-row lookup) purely to seed the
  // SuggestionSettings display below — getNeedsAttentionItems reads these
  // same values internally but doesn't return them, since every other
  // caller (the shell's pinned strip) only needs the computed items.
  const { data: prefsRow } = await supabase
    .from("coach_preferences")
    .select("suggestion_mode, suggestion_lead_days, suggestion_lead_mode, suggestion_lead_weekday")
    .eq("coach_id", user.id)
    .maybeSingle();
  const suggestionMode = (prefsRow?.suggestion_mode ?? "list") as "list" | "auto_add";
  const suggestionLeadDays = prefsRow?.suggestion_lead_days ?? 3;
  const suggestionLeadMode = (prefsRow?.suggestion_lead_mode ?? "days_before") as "days_before" | "weekday_before";
  const suggestionLeadWeekday = prefsRow?.suggestion_lead_weekday ?? 5;

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

      {/* The coach-desktop-shell's own pinned strip (coach_desktop_shell_
          identity_redesign.md) already shows this exact panel for the
          current group on every page, including this one — rendering it
          again here would be a literal duplicate in the default (non-
          scopeAll) view. Only show it inline when the coach has
          explicitly asked for the cross-group picture, which the
          shell's single-group strip can't provide. */}
      {scopeAll && <NeedsAttentionPanel coachId={user.id} items={needsAttentionItems} />}

      <h2 className="font-display uppercase text-sm tracking-wide text-steel mb-2">
        Recent activity
      </h2>

      {recentActivity.length === 0 ? (
        // v3_visual_polish_mockup_sept15.md's follow-up "Dashboard Empty
        // State & Business Tiles" mockup (the more specific, later-
        // approved spec for this exact card) — a real quiet-but-present
        // state with an actual next action, not bare gray placeholder
        // text and not just a passive icon+sentence.
        <div className="relative overflow-hidden p-5 mt-3.5 rounded-token-lg border border-rust/20 bg-[linear-gradient(160deg,rgb(var(--rust)/0.08),transparent_60%)]">
          <div className="w-9 h-9 rounded-token-md flex items-center justify-center bg-rust/[0.14] text-lg mb-3.5">
            👋
          </div>
          <p className="font-display uppercase text-base tracking-wide text-chalk">
            Quiet right now
          </p>
          <p className="font-body text-xs text-steel mt-1 mb-4 max-w-[38ch]">
            Nothing needs your attention yet — real activity from your roster will show up here as
            it happens.
          </p>
          <AddClientButton
            groupId={params.groupId}
            groupName={group?.name ?? "This group"}
            createdBy={user.id}
          />
        </div>
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

      {/* Moved off the top of the page and made collapsible
          (live_walkthrough_round2_findings.md) — this is a standing,
          rarely-touched preference (one row per coach, set once), not
          something that needs to greet a coach every time they open a
          page whose whole point is recent activity. Expanded by default
          only the very first time, before any real preference row
          exists yet — the one moment a coach actually needs to see it
          unprompted; collapsed on every visit after that. */}
      <div className="mt-8 max-w-2xl">
        <RosterSection
          title="Suggestion Settings"
          summary={
            suggestionMode === "auto_add"
              ? "Auto-add to calendar"
              : "Show as a list to review"
          }
          defaultExpanded={!prefsRow}
          variant="glow"
        >
          <SuggestionSettings
            coachId={user.id}
            initialMode={suggestionMode}
            initialLeadDays={suggestionLeadDays}
            initialLeadMode={suggestionLeadMode}
            initialLeadWeekday={suggestionLeadWeekday}
          />
        </RosterSection>
      </div>
    </CoachDesktopShell>
  );
}
