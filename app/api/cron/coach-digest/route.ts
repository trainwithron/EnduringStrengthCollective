import { NextResponse } from "next/server";
import { createServiceRoleClient } from "@/lib/supabase/service-role";
import { sendPushToProfile } from "@/lib/send-push";
import { findThreadsNeedingReply } from "@/lib/notification-priority";
import { DEFAULT_COACH_TIMEZONE, nowInZone } from "@/lib/timezone";

// Triggered daily by the Vercel Cron entry in vercel.json. No user
// session involved — auth is the CRON_SECRET header, same pattern as
// app/api/oura/sync/route.ts. Sends AT MOST ONE consolidated push per
// coach per day, across every group they coach — never one push per
// group, and never a push at all when there's genuinely nothing new.
export async function GET(request: Request) {
  if (!process.env.CRON_SECRET) {
    return NextResponse.json({ error: "CRON_SECRET isn't configured." }, { status: 503 });
  }
  const authHeader = request.headers.get("authorization");
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
  }

  const supabase = createServiceRoleClient();

  const { data: coachRows } = await supabase
    .from("group_memberships")
    .select("profile_id, group_id, groups ( group_kind )")
    .eq("role", "coach");

  const groupIdsByCoach = new Map<string, string[]>();
  const teamSocialGroupIdsByCoach = new Map<string, string[]>();
  for (const row of coachRows ?? []) {
    const coachId = row.profile_id;
    groupIdsByCoach.set(coachId, [...(groupIdsByCoach.get(coachId) ?? []), row.group_id]);
    const kind = (row as any).groups?.group_kind;
    if (kind === "team" || kind === "social" || !kind) {
      teamSocialGroupIdsByCoach.set(coachId, [...(teamSocialGroupIdsByCoach.get(coachId) ?? []), row.group_id]);
    }
  }

  // "Is it Monday" has to be asked in each coach's own zone, not whatever
  // day the cron's UTC clock happens to read — otherwise the weekly recap
  // fires a day early or late for anyone not in the UTC zone (same class
  // of bug as the workout-visibility lock — see lib/timezone.ts).
  const { data: timezoneRows } = await supabase
    .from("profiles")
    .select("id, timezone")
    .in("id", [...groupIdsByCoach.keys()]);
  const timezoneByCoach = new Map(
    (timezoneRows ?? []).map((r) => [r.id, r.timezone ?? DEFAULT_COACH_TIMEZONE])
  );

  const results: { coachId: string; sent: boolean; summary?: string }[] = [];

  for (const [coachId, groupIds] of groupIdsByCoach) {
    const parts: string[] = [];

    // "What's New" — the same coach_view_state comparison the desktop
    // sidebar badges already compute, run headlessly and WITHOUT marking
    // anything seen (the desktop badge still does that itself).
    const { data: viewStateRows } = await supabase
      .from("coach_view_state")
      .select("group_id, feed_seen_at, clients_seen_at")
      .eq("coach_id", coachId)
      .in("group_id", groupIds);

    const seenByGroup = new Map(
      (viewStateRows ?? []).map((r) => [r.group_id, { feed: r.feed_seen_at, clients: r.clients_seen_at }])
    );
    const visitedGroupIds = [...seenByGroup.keys()];

    let newPostCount = 0;
    const activeAthletes = new Set<string>();
    if (visitedGroupIds.length > 0) {
      const [{ data: recentPosts }, { data: recentLogs }] = await Promise.all([
        supabase.from("posts").select("group_id, created_at").in("group_id", visitedGroupIds),
        supabase.from("workout_logs").select("group_id, athlete_id, created_at").in("group_id", visitedGroupIds),
      ]);
      for (const groupId of visitedGroupIds) {
        const seen = seenByGroup.get(groupId)!;
        newPostCount += (recentPosts ?? []).filter(
          (p) => p.group_id === groupId && (!seen.feed || p.created_at > seen.feed)
        ).length;
        for (const log of recentLogs ?? []) {
          if (log.group_id === groupId && log.athlete_id && (!seen.clients || log.created_at > seen.clients)) {
            activeAthletes.add(log.athlete_id);
          }
        }
      }
    }
    if (newPostCount > 0 || activeAthletes.size > 0) {
      const bits: string[] = [];
      if (newPostCount > 0) bits.push(`${newPostCount} new post${newPostCount === 1 ? "" : "s"}`);
      if (activeAthletes.size > 0) bits.push(`${activeAthletes.size} client${activeAthletes.size === 1 ? "" : "s"} active`);
      parts.push(bits.join(", "));
    }

    // Stale reply-needed threads — same helper the Home dashboard's
    // "Needs a reply" banner already uses.
    const teamSocialIds = teamSocialGroupIdsByCoach.get(coachId) ?? [];
    if (teamSocialIds.length > 0) {
      const [{ data: commentRows }, { data: dismissedRows }] = await Promise.all([
        supabase.from("comments").select("post_id, group_id, author_id, created_at").in("group_id", teamSocialIds),
        supabase.from("coach_dismissed_reply_alerts").select("post_id, dismissed_at").eq("coach_id", coachId),
      ]);
      const dismissedAt = new Map((dismissedRows ?? []).map((d) => [d.post_id, d.dismissed_at]));
      const stale = findThreadsNeedingReply(
        (commentRows ?? []).map((c) => ({
          postId: c.post_id,
          groupId: c.group_id,
          authorId: c.author_id,
          createdAt: c.created_at,
        })),
        coachId,
        new Date(),
        8,
        dismissedAt
      );
      if (stale.length > 0) {
        parts.push(`${stale.length} question${stale.length === 1 ? "" : "s"} need${stale.length === 1 ? "s" : ""} a reply`);
      }
    }

    // Weekly business recap — Mondays only (in this coach's own zone),
    // income across every group this coach runs over the last 7 days.
    const isMonday = nowInZone(timezoneByCoach.get(coachId) ?? DEFAULT_COACH_TIMEZONE).getUTCDay() === 1;
    if (isMonday) {
      const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
      const { data: purchases } = await supabase
        .from("credit_purchases")
        .select("amount_cents")
        .in("group_id", groupIds)
        .gte("created_at", sevenDaysAgo);
      const incomeCents = (purchases ?? []).reduce((sum, p) => sum + (p.amount_cents ?? 0), 0);
      if (incomeCents > 0) {
        parts.push(`$${(incomeCents / 100).toFixed(0)} income this week`);
      }
    }

    if (parts.length === 0) {
      results.push({ coachId, sent: false });
      continue;
    }

    const summary = parts.join(" · ");
    const sent = await sendPushToProfile(supabase, coachId, "Your business, since you last checked", summary, "/dashboard");
    results.push({ coachId, sent: sent > 0, summary });
  }

  return NextResponse.json({ coaches: results.length, results });
}
