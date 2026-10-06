import { NextResponse } from "next/server";
import { createServiceRoleClient } from "@/lib/supabase/service-role";
import { sendPushToProfile } from "@/lib/send-push";
import { getGroupCoachTimezone, dateKeyInZone, nowInZone } from "@/lib/timezone";
import { loadProgramDayContexts, resolveSessionsForDate } from "@/lib/program-day-contexts";
import { isHabitDueOn } from "@/lib/habits";
import { withCronRun } from "@/lib/cron-monitor";
import { goalLabelFor, restDayNudgeBody, restNudgeDecision } from "@/lib/rest-day-nudge";

// Triggered daily by the Vercel Cron entry in vercel.json. No user
// session involved — auth is the CRON_SECRET header, same pattern as
// app/api/cron/coach-digest/route.ts. A day with no scheduled workout is
// idle time too (custom_shape_theming_idea.md, item 4) — this reuses the
// exact pending-item detection already built for the rest-timer gate (a
// due habit not yet checked off, or no wellness check-in today): only a
// genuine "rest" day (per resolveDayWorkout — a scheduled program with
// nothing landing on today's date) with something genuinely pending
// triggers a push. At most one push per athlete per day, across every
// group they're in, never one per group. Like coach-digest, this fires
// at one fixed UTC time rather than per-athlete-timezone — a stated,
// accepted limitation, not solved here.
async function handler(request: Request) {
  if (!process.env.CRON_SECRET) {
    return NextResponse.json({ error: "CRON_SECRET isn't configured." }, { status: 503 });
  }
  const authHeader = request.headers.get("authorization");
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
  }

  const supabase = createServiceRoleClient();

  const { data: memberships } = await supabase
    .from("group_memberships")
    .select("profile_id, group_id")
    .eq("role", "athlete");

  const groupIdsByAthlete = new Map<string, string[]>();
  for (const row of memberships ?? []) {
    groupIdsByAthlete.set(row.profile_id, [...(groupIdsByAthlete.get(row.profile_id) ?? []), row.group_id]);
  }

  const results: { athleteId: string; groupId: string; sent: boolean }[] = [];

  for (const [athleteId, groupIds] of groupIdsByAthlete) {
    for (const groupId of groupIds) {
      const timezone = await getGroupCoachTimezone(supabase, groupId);
      const todayKey = dateKeyInZone(timezone);
      const today = nowInZone(timezone);

      // Several programs can be active (main, mobility, warm-up). It is only a rest day if none of
      // the scheduled ones has something today. Unscheduled ("playlist mode") programs have no
      // calendar dates, so "rest day" isn't a real concept for them.
      const contexts = await loadProgramDayContexts(supabase, groupId, athleteId);
      const scheduledContexts = contexts.filter((c) => !c.unscheduled && c.scheduled.length > 0);
      if (scheduledContexts.length === 0) continue;
      if (contexts.some((c) => c.unscheduled)) continue;
      const hasSomethingToday = resolveSessionsForDate(scheduledContexts, new Set(), today, today, true).length > 0;
      if (hasSomethingToday) continue;

      // Same pending-item detection as the rest-timer gate: a real due
      // habit not yet completed, or no wellness check-in today — never
      // invented to fill space when neither is actually true.
      const [{ data: habitRows }, { data: wellnessRow }] = await Promise.all([
        supabase
          .from("client_habits")
          .select("id, weekdays")
          .eq("athlete_id", athleteId)
          .eq("group_id", groupId)
          .eq("active", true),
        supabase
          .from("wellness_checkins")
          .select("id")
          .eq("athlete_id", athleteId)
          .eq("group_id", groupId)
          .eq("log_date", todayKey)
          .maybeSingle(),
      ]);

      const dueHabits = (habitRows ?? []).filter((h) => isHabitDueOn(h.weekdays, today));
      let hasPendingHabit = false;
      if (dueHabits.length > 0) {
        const { data: logRows } = await supabase
          .from("habit_logs")
          .select("habit_id, completed_at")
          .in("habit_id", dueHabits.map((h) => h.id))
          .eq("log_date", todayKey);
        const completedIds = new Set((logRows ?? []).filter((l) => l.completed_at).map((l) => l.habit_id));
        hasPendingHabit = dueHabits.some((h) => !completedIds.has(h.id));
      }

      if (!hasPendingHabit && wellnessRow) continue;

      // Limits (Ron, Oct 6): at most 2 in any 7 days, none after 3 in a row with no response. The record of what was sent is a table from
      // migration 0285; until it exists nothing is sent, because the cap cannot be known.
      const { data: nudgeRows, error: nudgeError } = await supabase
        .from("rest_day_nudges")
        .select("sent_at")
        .eq("athlete_id", athleteId)
        .gte("sent_at", new Date(Date.now() - 120 * 86400000).toISOString());
      if (nudgeError) continue;
      const [lastCheckin, lastWorkout, lastHabit] = await Promise.all([
        supabase.from("wellness_checkins").select("created_at").eq("athlete_id", athleteId).order("created_at", { ascending: false }).limit(1).maybeSingle(),
        supabase.from("workout_logs").select("created_at").eq("athlete_id", athleteId).order("created_at", { ascending: false }).limit(1).maybeSingle(),
        supabase
          .from("habit_logs")
          .select("completed_at, client_habits!inner ( athlete_id )")
          .eq("client_habits.athlete_id", athleteId)
          .not("completed_at", "is", null)
          .order("completed_at", { ascending: false })
          .limit(1)
          .maybeSingle(),
      ]);
      const activity = [lastCheckin.data?.created_at, lastWorkout.data?.created_at, (lastHabit.data as { completed_at?: string } | null)?.completed_at]
        .filter((x): x is string => !!x)
        .map((x) => new Date(x).getTime());
      const decision = restNudgeDecision({
        nudgeTimes: (nudgeRows ?? []).map((r) => new Date(r.sent_at as string)),
        lastActivityAt: activity.length > 0 ? new Date(Math.max(...activity)) : null,
        now: new Date(),
      });
      if (!decision.send) continue;

      // Name the client's own goal when they have a confirmed one.
      const { data: goalRow } = await supabase
        .from("client_goals")
        .select("goal_type, custom_label")
        .eq("athlete_id", athleteId)
        .eq("group_id", groupId)
        .eq("status", "confirmed")
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();

      const sent = await sendPushToProfile(
        supabase,
        athleteId,
        "No workout today",
        restDayNudgeBody(goalLabelFor(goalRow?.goal_type, goalRow?.custom_label)),
        `/groups/${groupId}`
      );
      if (sent > 0) await supabase.from("rest_day_nudges").insert({ athlete_id: athleteId, group_id: groupId });
      results.push({ athleteId, groupId, sent: sent > 0 });
      break; // one push per athlete per day, even if several groups qualify
    }
  }

  return NextResponse.json({ athletes: groupIdsByAthlete.size, sent: results.length, results });
}

export const GET = withCronRun("rest-day-nudge", handler);
