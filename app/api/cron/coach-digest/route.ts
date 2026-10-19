import { NextResponse } from "next/server";
import { createServiceRoleClient } from "@/lib/supabase/service-role";
import { sendCoachPush } from "@/lib/coach-notice";
import { findThreadsNeedingReply } from "@/lib/notification-priority";
import { DEFAULT_COACH_TIMEZONE, nowInZone } from "@/lib/timezone";
import { withCronRun } from "@/lib/cron-monitor";
import { pageAll } from "@/lib/page-all";
import { readRowsByIds } from "@/lib/read-by-ids";
import { runPool } from "@/lib/run-pool";

// One digest per coach and organization: a few at a time (not one after another), and no new coach is started past the time budget.
export const maxDuration = 300;
const COACHES_AT_ONCE = 8;
const TIME_BUDGET_MS = 270_000;

// Triggered daily by the Vercel Cron entry in vercel.json. No user
// session involved — auth is the CRON_SECRET header, same pattern as
// app/api/oura/sync/route.ts. Sends AT MOST ONE consolidated push per
// coach PER ORGANIZATION per day — never one push per group, never one message that mixes two organizations (a coach who runs several gets one for
// each, labeled with the organization's name), and never a push at all when there's genuinely nothing new.
async function handler(request: Request) {
  if (!process.env.CRON_SECRET) {
    return NextResponse.json({ error: "CRON_SECRET isn't configured." }, { status: 503 });
  }
  const authHeader = request.headers.get("authorization");
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
  }

  const supabase = createServiceRoleClient();

  // Every coach seat, a page at a time (a request returns at most 1,000 rows).
  const { rows: coachRows, failed: coachRowsFailed } = await pageAll((from, to) =>
    supabase.from("group_memberships").select("profile_id, group_id, groups ( group_kind, organization_id, organizations ( name ) )").eq("role", "coach").order("id").range(from, to)
  );
  if (coachRowsFailed) return NextResponse.json({ error: "Could not read the coaches." }, { status: 500 });

  // One entry per (coach, organization).
  const groupIdsByCoach = new Map<string, string[]>();
  const teamSocialGroupIdsByCoach = new Map<string, string[]>();
  const entryInfo = new Map<string, { coachId: string; orgName: string | null }>();
  const orgCountByCoach = new Map<string, Set<string>>();
  for (const row of coachRows) {
    const g = (row as any).groups;
    // A personal space belongs to no organization and has no clients: it is not part of the digest.
    if (!g?.organization_id) continue;
    const key = `${row.profile_id}|${g?.organization_id ?? "none"}`;
    entryInfo.set(key, { coachId: row.profile_id, orgName: g?.organizations?.name ?? null });
    orgCountByCoach.set(row.profile_id, (orgCountByCoach.get(row.profile_id) ?? new Set<string>()).add(g?.organization_id ?? "none"));
    groupIdsByCoach.set(key, [...(groupIdsByCoach.get(key) ?? []), row.group_id]);
    const kind = g?.group_kind;
    if (kind === "team" || kind === "social" || !kind) {
      teamSocialGroupIdsByCoach.set(key, [...(teamSocialGroupIdsByCoach.get(key) ?? []), row.group_id]);
    }
  }

  // "Is it Monday" has to be asked in each coach's own zone, not whatever
  // day the cron's UTC clock happens to read — otherwise the weekly recap
  // fires a day early or late for anyone not in the UTC zone (same class
  // of bug as the workout-visibility lock — see lib/timezone.ts).
  const { data: timezoneRows } = await readRowsByIds([...new Set([...entryInfo.values()].map((e) => e.coachId))], (g) => (from, to) =>
    supabase.from("profiles").select("id, timezone").in("id", g).order("id").range(from, to)
  );
  const timezoneByCoach = new Map(
    (timezoneRows ?? []).map((r) => [r.id, r.timezone ?? DEFAULT_COACH_TIMEZONE])
  );

  const results: { coachId: string; sent: boolean; summary?: string }[] = [];

  const processEntry = async ([entryKey, groupIds]: [string, string[]]): Promise<void> => {
    const { coachId, orgName } = entryInfo.get(entryKey)!;
    const parts: string[] = [];

    // "What's New" — the same coach_view_state comparison the desktop
    // sidebar badges already compute, run headlessly and WITHOUT marking
    // anything seen (the desktop badge still does that itself).
    // The database counts the new posts and the distinct active clients since this coach last looked, in the groups they have visited (no read of every post and workout ever logged).
    let newPostCount = 0;
    let activeAthleteCount = 0;
    const { data: activityRows, error: activityError } = await supabase.rpc("coach_digest_activity", { p_coach: coachId, p_group_ids: groupIds });
    if (activityError) console.error("coach-digest: could not count new activity:", activityError.message);
    const activity = Array.isArray(activityRows) ? activityRows[0] : activityRows;
    newPostCount = Number(activity?.new_posts ?? 0);
    activeAthleteCount = Number(activity?.active_athletes ?? 0);
    if (newPostCount > 0 || activeAthleteCount > 0) {
      const bits: string[] = [];
      if (newPostCount > 0) bits.push(`${newPostCount} new post${newPostCount === 1 ? "" : "s"}`);
      if (activeAthleteCount > 0) bits.push(`${activeAthleteCount} client${activeAthleteCount === 1 ? "" : "s"} active`);
      parts.push(bits.join(", "));
    }

    // Stale reply-needed threads — same helper the Home dashboard's
    // "Needs a reply" banner already uses.
    const teamSocialIds = teamSocialGroupIdsByCoach.get(entryKey) ?? [];
    if (teamSocialIds.length > 0) {
      const [{ data: commentRows }, { data: dismissedRows }] = await Promise.all([
        readRowsByIds(teamSocialIds, (g) => (from, to) => supabase.from("comments").select("post_id, group_id, author_id, created_at").in("group_id", g).order("id").range(from, to)),
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
      const { data: purchases } = await readRowsByIds(groupIds, (g) => (from, to) =>
        supabase.from("credit_purchases").select("amount_cents").in("group_id", g).gte("created_at", sevenDaysAgo).order("id").range(from, to)
      );
      const incomeCents = (purchases ?? []).reduce((sum, p) => sum + (p.amount_cents ?? 0), 0);
      if (incomeCents > 0) {
        parts.push(`$${(incomeCents / 100).toFixed(0)} income this week`);
      }
    }

    if (parts.length === 0) {
      results.push({ coachId, sent: false });
      return;
    }

    const summary = parts.join(" · ");
    // A coach who runs several organizations gets each one's digest labeled with its name.
    const title = (orgCountByCoach.get(coachId)?.size ?? 1) > 1 && orgName ? `${orgName}: since you last checked` : "Your business, since you last checked";
    const sent = await sendCoachPush(supabase, coachId, "briefing", title, summary, "/dashboard");
    results.push({ coachId, sent: sent > 0, summary });
  };
  const run = await runPool([...groupIdsByCoach.entries()], COACHES_AT_ONCE, processEntry, { deadlineMs: TIME_BUDGET_MS });
  if (run.notStarted.length > 0) console.error(`coach-digest: out of time, ${run.notStarted.length} digests were not made today`);
  if (run.failed.length > 0) console.error(`coach-digest: ${run.failed.length} digests failed`);

  return NextResponse.json({ coaches: results.length, results });
}

export const GET = withCronRun("coach-digest", handler);
