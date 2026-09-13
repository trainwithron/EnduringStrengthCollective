import { NextResponse } from "next/server";
import { createServiceRoleClient } from "@/lib/supabase/service-role";
import { sendPushToProfile } from "@/lib/send-push";
import { getGroupCoachTimezone, dateKeyInZone, nowInZone } from "@/lib/timezone";
import { getActiveProgramForAthlete, getScheduledWorkouts, resolveDayWorkout } from "@/lib/athlete-day-schedule";
import { isHabitDueOn } from "@/lib/habits";

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
export async function GET(request: Request) {
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

      const program = await getActiveProgramForAthlete(supabase, groupId, athleteId);
      if (!program) continue;
      const scheduledWorkouts = await getScheduledWorkouts(supabase, program);
      // Unscheduled ("playlist mode") programs have no calendar dates at
      // all, so "rest day" isn't a real concept for them — matches the
      // existing design decision in athlete-day-schedule.ts.
      if (scheduledWorkouts.length === 0) continue;

      const dayInfo = resolveDayWorkout(scheduledWorkouts, new Set(), today, today, program.visibilityWindow);
      if (dayInfo.status !== "rest") continue;

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

      const sent = await sendPushToProfile(
        supabase,
        athleteId,
        "No workout today",
        "Rest day — got a minute for a quick check-in?",
        `/groups/${groupId}`
      );
      results.push({ athleteId, groupId, sent: sent > 0 });
      break; // one push per athlete per day, even if several groups qualify
    }
  }

  return NextResponse.json({ athletes: groupIdsByAthlete.size, sent: results.length, results });
}
