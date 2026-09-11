import Link from "next/link";
import { redirect } from "next/navigation";
import { createServerClient } from "@/lib/supabase/server";
import { CoachDesktopShell } from "@/components/coach/coach-desktop-shell";
import { TrendChart } from "@/components/coach/desktop/trend-chart";
import { computeEngagement } from "@/lib/business-metrics";
import { computeDailyAverageReadiness, computeWeeklyActivity } from "@/lib/team-performance-metrics";
import { computeReadinessAverage, isLowReadiness } from "@/lib/wellness";
import { isHabitDueOn } from "@/lib/habits";

function dateKey(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(
    d.getDate()
  ).padStart(2, "0")}`;
}

export default async function TeamPerformancePage(
  props: { params: Promise<{ groupId: string }> }
) {
  const params = await props.params;
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
        <p className="font-body text-steel text-center">
          Only coaches can view the team performance dashboard.
        </p>
      </main>
    );
  }

  const { data: group } = await supabase
    .from("groups")
    .select("name")
    .eq("id", params.groupId)
    .single();

  const { data: memberRows } = await supabase
    .from("group_memberships")
    .select("profile_id, profiles ( full_name )")
    .eq("group_id", params.groupId)
    .eq("role", "athlete");
  const roster = (memberRows ?? []).map((m: any) => ({
    athleteId: m.profile_id,
    fullName: m.profiles?.full_name ?? "Unknown",
  }));
  const athleteIds = roster.map((r) => r.athleteId);

  const today = new Date();
  const todayKey = dateKey(today);
  const weekStart = new Date(today);
  weekStart.setDate(today.getDate() - 6);
  const weekStartKey = dateKey(weekStart);
  const monthKey = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, "0")}`;
  const thirtyDaysAgoKey = dateKey(new Date(today.getFullYear(), today.getMonth(), today.getDate() - 29));
  const eightWeeksAgoKey = dateKey(new Date(today.getFullYear(), today.getMonth(), today.getDate() - 55));

  // Scoped to the roster's own athlete ids — a coach's own logged
  // workout (e.g. testing a program) shouldn't count toward "the team's"
  // activity, and must match exactly what the roster list below shows.
  const { data: logRows } = await supabase
    .from("workout_logs")
    .select("athlete_id, total_volume, new_prs, created_at")
    .eq("group_id", params.groupId)
    .in("athlete_id", athleteIds.length > 0 ? athleteIds : ["00000000-0000-0000-0000-000000000000"])
    .gte("created_at", eightWeeksAgoKey);

  const lastActiveByAthlete = new Map<string, string>();
  const workoutsThisWeekByAthlete = new Map<string, number>();
  const prsThisMonthByAthlete = new Map<string, number>();
  for (const log of logRows ?? []) {
    const key = dateKey(new Date(log.created_at));
    if (!lastActiveByAthlete.has(log.athlete_id) || key > lastActiveByAthlete.get(log.athlete_id)!) {
      lastActiveByAthlete.set(log.athlete_id, key);
    }
    if (key >= weekStartKey) {
      workoutsThisWeekByAthlete.set(log.athlete_id, (workoutsThisWeekByAthlete.get(log.athlete_id) ?? 0) + 1);
    }
    if (key.startsWith(monthKey)) {
      prsThisMonthByAthlete.set(log.athlete_id, (prsThisMonthByAthlete.get(log.athlete_id) ?? 0) + (log.new_prs?.length ?? 0));
    }
  }
  const workoutsThisWeek = [...workoutsThisWeekByAthlete.values()].reduce((sum, n) => sum + n, 0);
  const prsThisMonth = [...prsThisMonthByAthlete.values()].reduce((sum, n) => sum + n, 0);
  const engagement = computeEngagement(
    roster.map((r) => ({ lastActiveDateKey: lastActiveByAthlete.get(r.athleteId) ?? null })),
    todayKey,
    7
  );
  const weeklyActivity = computeWeeklyActivity(
    (logRows ?? []).map((l) => dateKey(new Date(l.created_at))),
    todayKey,
    8
  );
  const maxWeeklyCount = Math.max(1, ...weeklyActivity.map((b) => b.count));

  const safeAthleteIds = athleteIds.length > 0 ? athleteIds : ["00000000-0000-0000-0000-000000000000"];

  const { data: wellnessRows } = await supabase
    .from("wellness_checkins")
    .select("athlete_id, log_date, sleep_quality, soreness, energy")
    .eq("group_id", params.groupId)
    .in("athlete_id", safeAthleteIds)
    .gte("log_date", thirtyDaysAgoKey);
  const readinessTrend = computeDailyAverageReadiness(
    (wellnessRows ?? []).map((r) => ({
      logDate: r.log_date,
      sleepQuality: r.sleep_quality,
      soreness: r.soreness,
      energy: r.energy,
    }))
  );
  const todaysWellness = (wellnessRows ?? []).filter((r) => r.log_date === todayKey);
  const avgReadinessToday =
    todaysWellness.length > 0
      ? todaysWellness.reduce(
          (sum, r) => sum + computeReadinessAverage({ sleepQuality: r.sleep_quality, soreness: r.soreness, energy: r.energy }),
          0
        ) / todaysWellness.length
      : null;
  const lowReadinessToday = todaysWellness.filter((r) =>
    isLowReadiness({ sleepQuality: r.sleep_quality, soreness: r.soreness, energy: r.energy })
  ).length;
  const readinessTodayByAthlete = new Map(
    todaysWellness.map((r) => [
      r.athlete_id,
      computeReadinessAverage({ sleepQuality: r.sleep_quality, soreness: r.soreness, energy: r.energy }),
    ])
  );

  const { data: habitRows } = await supabase
    .from("client_habits")
    .select("id, athlete_id, weekdays")
    .eq("group_id", params.groupId)
    .in("athlete_id", safeAthleteIds)
    .eq("active", true);
  const activeHabits = habitRows ?? [];
  const last7Dates = Array.from({ length: 7 }, (_, i) => {
    const d = new Date(weekStart);
    d.setDate(d.getDate() + i);
    return d;
  });

  const { data: habitLogRows } = await supabase
    .from("habit_logs")
    .select("habit_id, log_date, completed_at")
    .in("habit_id", activeHabits.map((h) => h.id))
    .gte("log_date", weekStartKey)
    .lte("log_date", todayKey);
  const completedSet = new Set(
    (habitLogRows ?? []).filter((l) => l.completed_at).map((l) => `${l.habit_id}:${l.log_date}`)
  );

  let totalHabitsDue = 0;
  let totalHabitsCompleted = 0;
  const habitStatsByAthlete = new Map<string, { due: number; completed: number }>();
  for (const habit of activeHabits) {
    const dueDates = last7Dates.filter((d) => isHabitDueOn(habit.weekdays, d));
    const completed = dueDates.filter((d) => completedSet.has(`${habit.id}:${dateKey(d)}`)).length;
    totalHabitsDue += dueDates.length;
    totalHabitsCompleted += completed;
    const existing = habitStatsByAthlete.get(habit.athlete_id) ?? { due: 0, completed: 0 };
    habitStatsByAthlete.set(habit.athlete_id, {
      due: existing.due + dueDates.length,
      completed: existing.completed + completed,
    });
  }
  const habitCompliancePct = totalHabitsDue > 0 ? Math.round((totalHabitsCompleted / totalHabitsDue) * 100) : 0;

  return (
    <CoachDesktopShell groupId={params.groupId} groupName={group?.name ?? "Coaching"} active="team-performance">
      <div className="pb-6 border-b border-steel/20 mb-6">
        <h1 className="font-display font-bold text-3xl uppercase leading-none">Team Performance</h1>
        <p className="font-body text-sm text-steel mt-2 max-w-[70ch]">
          Roster-wide trends for this group — activity, PRs, wellness, and habit compliance.
        </p>
      </div>

      <div className="grid grid-cols-3 gap-4 mb-8">
        <div className="border border-steel/20 p-4">
          <p className="font-display text-3xl leading-none">{roster.length}</p>
          <p className="font-body text-xs text-steel mt-1 uppercase tracking-wide">Roster size</p>
        </div>
        <div className="border border-steel/20 p-4">
          <p className="font-display text-3xl leading-none">
            {engagement.activeCount}/{engagement.totalCount}
          </p>
          <p className="font-body text-xs text-steel mt-1 uppercase tracking-wide">Active this week</p>
          <p className="font-body text-[11px] text-steel mt-0.5">{engagement.pct}% logged a workout</p>
        </div>
        <div className="border border-steel/20 p-4">
          <p className="font-display text-3xl leading-none">{workoutsThisWeek}</p>
          <p className="font-body text-xs text-steel mt-1 uppercase tracking-wide">Workouts this week</p>
        </div>
        <div className="border border-steel/20 p-4">
          <p className="font-display text-3xl leading-none">{prsThisMonth}</p>
          <p className="font-body text-xs text-steel mt-1 uppercase tracking-wide">PRs this month</p>
        </div>
        <div className="border border-steel/20 p-4">
          <p className="font-display text-3xl leading-none">
            {avgReadinessToday != null ? avgReadinessToday.toFixed(1) : "—"}
          </p>
          <p className="font-body text-xs text-steel mt-1 uppercase tracking-wide">Avg readiness today</p>
          {lowReadinessToday > 0 ? (
            <p className="font-body text-[11px] text-rust mt-0.5">{lowReadinessToday} flagged low</p>
          ) : (
            <p className="font-body text-[11px] text-steel mt-0.5">
              {avgReadinessToday != null ? "Out of 5" : "No check-ins yet"}
            </p>
          )}
        </div>
        <div className="border border-steel/20 p-4">
          <p className="font-display text-3xl leading-none">{habitCompliancePct}%</p>
          <p className="font-body text-xs text-steel mt-1 uppercase tracking-wide">Habit compliance</p>
          <p className="font-body text-[11px] text-steel mt-0.5">Last 7 days</p>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-6 mb-8">
        <div className="border border-steel/20 p-4">
          <h2 className="font-display uppercase text-sm tracking-wide text-steel mb-3">
            Weekly Activity (last 8 weeks)
          </h2>
          <div className="flex items-end gap-2 h-28">
            {weeklyActivity.map((b) => (
              <div key={b.weekLabel} className="flex-1 flex flex-col items-center gap-1.5">
                <span className="font-body text-[11px] text-chalk">{b.count}</span>
                <div
                  className="w-full bg-rust"
                  style={{ height: `${Math.max(4, (b.count / maxWeeklyCount) * 80)}px` }}
                />
                <span className="font-body text-[9px] text-steel">{b.weekLabel}</span>
              </div>
            ))}
          </div>
        </div>

        <div className="border border-steel/20 p-4">
          <h2 className="font-display uppercase text-sm tracking-wide text-steel mb-3">
            Readiness Trend (last 30 days)
          </h2>
          <TrendChart points={readinessTrend} emptyLabel="Not enough check-ins yet." />
        </div>
      </div>

      <div>
        <div className="flex items-center justify-between mb-3">
          <h2 className="font-display uppercase text-sm tracking-wide text-steel">Roster</h2>
          <Link
            href={`/groups/${params.groupId}/feed?channel=general`}
            className="font-body text-xs text-rust"
          >
            See full leaderboard →
          </Link>
        </div>
        <div className="divide-y divide-steel/15">
          {roster.length === 0 ? (
            <p className="font-body text-sm text-steel py-2">No athletes yet.</p>
          ) : (
            roster
              .slice()
              .sort((a, b) => a.fullName.localeCompare(b.fullName))
              .map((r) => {
                const habitStats = habitStatsByAthlete.get(r.athleteId);
                const pct = habitStats && habitStats.due > 0 ? Math.round((habitStats.completed / habitStats.due) * 100) : null;
                const readinessToday = readinessTodayByAthlete.get(r.athleteId);
                return (
                  <div key={r.athleteId} className="py-2.5 flex items-center justify-between gap-4">
                    <span className="font-body text-sm">{r.fullName}</span>
                    <div className="flex items-center gap-5 font-body text-xs text-steel">
                      <span>{workoutsThisWeekByAthlete.get(r.athleteId) ?? 0} workouts</span>
                      <span>{prsThisMonthByAthlete.get(r.athleteId) ?? 0} PRs</span>
                      <span>{readinessToday != null ? readinessToday.toFixed(1) : "—"} readiness</span>
                      <span>{pct != null ? `${pct}%` : "—"} habits</span>
                    </div>
                  </div>
                );
              })
          )}
        </div>
      </div>
    </CoachDesktopShell>
  );
}
