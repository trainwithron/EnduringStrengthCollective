import Link from "next/link";
import { redirect } from "next/navigation";
import { createServerClient } from "@/lib/supabase/server";
import { CoachDesktopShell } from "@/components/coach/coach-desktop-shell";
import { AthleteNotesEditor } from "@/components/coach/athlete-notes-editor";
import { SessionCreditsControl } from "@/components/coach/session-credits-control";
import { PackageAssignmentControl } from "@/components/coach/package-assignment-control";
import { PrivateFromOrgToggle } from "@/components/coach/private-from-org-toggle";
import { CoachLoggedBadge } from "@/components/coach-logged-badge";
import { NutritionTools } from "@/components/coach/desktop/nutrition-tools";
import { TrendChart } from "@/components/coach/desktop/trend-chart";
import { ExerciseProgressionChart } from "@/components/coach/desktop/exercise-progression-chart";
import { isHabitDueOn } from "@/lib/habits";
import { computeWeeklyWeightTrend } from "@/lib/weight-trend";

export default async function AthleteProfilePage(
  props: {
    params: Promise<{ groupId: string; athleteId: string }>;
  }
) {
  const params = await props.params;
  const supabase = createServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect("/login");
  }

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
          Only coaches can view client profiles.
        </p>
      </main>
    );
  }

  const { data: athleteMembership } = await supabase
    .from("group_memberships")
    .select("joined_at, client_tier, private_from_org, profiles ( id, full_name, avatar_url )")
    .eq("group_id", params.groupId)
    .eq("profile_id", params.athleteId)
    .maybeSingle();

  if (!athleteMembership) {
    return (
      <main className="min-h-screen bg-graphite text-chalk flex items-center justify-center px-6">
        <p className="font-body text-steel text-center">
          This client isn&apos;t in this group.
        </p>
      </main>
    );
  }

  const profile = athleteMembership.profiles as any;
  // Same gate used everywhere else this tier's feature set is hidden —
  // group-tier clients don't get macro/meal-plan programming at all.
  const macrosEnabled = athleteMembership.client_tier !== "group";

  const { data: group } = await supabase
    .from("groups")
    .select("name")
    .eq("id", params.groupId)
    .single();

  // This client's own personal program wins over the group's shared one —
  // same precedence as lib/todays-workout.ts.
  const { data: personalProgram } = await supabase
    .from("programs")
    .select("id, name")
    .eq("group_id", params.groupId)
    .eq("athlete_id", params.athleteId)
    .eq("is_active", true)
    .maybeSingle();

  const { data: sharedProgram } = personalProgram
    ? { data: null }
    : await supabase
        .from("programs")
        .select("id, name")
        .eq("group_id", params.groupId)
        .is("athlete_id", null)
        .eq("is_active", true)
        .maybeSingle();

  const activeProgram = personalProgram ?? sharedProgram;

  // Stats (total count, volume, PRs) need every logged workout to stay
  // accurate — the displayed history below is capped separately so the
  // page doesn't slow down after months of real use.
  const { data: allLogs } = await supabase
    .from("workout_logs")
    .select("total_volume, new_prs, created_at")
    .eq("athlete_id", params.athleteId)
    .eq("group_id", params.groupId);

  const totalCompleted = allLogs?.length ?? 0;
  const totalVolume = (allLogs ?? []).reduce((sum, l) => sum + (l.total_volume ?? 0), 0);

  const prEntries: { exerciseName: string; date: string }[] = [];
  for (const log of allLogs ?? []) {
    for (const name of log.new_prs ?? []) {
      prEntries.push({ exerciseName: name, date: log.created_at });
    }
  }
  prEntries.sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());

  const RECENT_LOGS_LIMIT = 50;
  const { data: logs } = await supabase
    .from("workout_logs")
    .select(
      "id, total_volume, total_sets_completed, new_prs, created_at, logged_by_coach, workouts ( title, week_number, day_index )"
    )
    .eq("athlete_id", params.athleteId)
    .eq("group_id", params.groupId)
    .order("created_at", { ascending: false })
    .limit(RECENT_LOGS_LIMIT);

  const workoutLogs = logs ?? [];

  const { data: noteRow } = await supabase
    .from("athlete_notes")
    .select("id, body")
    .eq("athlete_id", params.athleteId)
    .eq("group_id", params.groupId)
    .maybeSingle();

  const { data: creditsRow } = await supabase
    .from("session_credits")
    .select("balance")
    .eq("athlete_id", params.athleteId)
    .eq("group_id", params.groupId)
    .maybeSingle();

  // Published packages need no assignment — every client already sees
  // them — so only private ones are relevant to assign from this page.
  const { data: privatePackageRows } = await supabase
    .from("coach_packages")
    .select("id, name, sessions_per_week, rate_cents, sessions_granted")
    .eq("group_id", params.groupId)
    .eq("is_active", true)
    .eq("is_public", false)
    .order("sessions_per_week", { ascending: true });

  const { data: assignmentRows } = await supabase
    .from("package_assignments")
    .select("coach_package_id")
    .eq("athlete_id", params.athleteId)
    .in("coach_package_id", (privatePackageRows ?? []).map((p) => p.id));
  const assignedPackageIds = (assignmentRows ?? []).map((a) => a.coach_package_id);

  // Last-7-days habit compliance — the one piece of this that's actually
  // measurable today. Macro targets are coach-set but nothing logs what
  // the athlete actually ate yet, so this deliberately reports "days with
  // a target set" rather than a fabricated "compliance" number for macros.
  const sevenDaysAgo = new Date();
  sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 6);
  const weekStartKey = sevenDaysAgo.toISOString().slice(0, 10);
  const todayKey = new Date().toISOString().slice(0, 10);
  const last7Dates = Array.from({ length: 7 }, (_, i) => {
    const d = new Date(sevenDaysAgo);
    d.setDate(d.getDate() + i);
    return d;
  });

  const { data: habitRows } = await supabase
    .from("client_habits")
    .select("id, title, weekdays")
    .eq("athlete_id", params.athleteId)
    .eq("group_id", params.groupId)
    .eq("active", true);
  const activeHabits = habitRows ?? [];

  const { data: habitLogRows } = await supabase
    .from("habit_logs")
    .select("habit_id, log_date, completed_at")
    .in("habit_id", activeHabits.map((h) => h.id))
    .gte("log_date", weekStartKey)
    .lte("log_date", todayKey);
  const completedSet = new Set(
    (habitLogRows ?? []).filter((l) => l.completed_at).map((l) => `${l.habit_id}:${l.log_date}`)
  );

  const habitCompliance = activeHabits.map((h) => {
    const dueDates = last7Dates.filter((d) => isHabitDueOn(h.weekdays, d));
    const completed = dueDates.filter((d) =>
      completedSet.has(`${h.id}:${d.toISOString().slice(0, 10)}`)
    ).length;
    return { title: h.title, completed, due: dueDates.length };
  });
  const totalHabitsDue = habitCompliance.reduce((sum, h) => sum + h.due, 0);
  const totalHabitsCompleted = habitCompliance.reduce((sum, h) => sum + h.completed, 0);

  const { data: macroRows } = await supabase
    .from("daily_macros")
    .select("log_date")
    .eq("athlete_id", params.athleteId)
    .gte("log_date", weekStartKey)
    .lte("log_date", todayKey)
    .not("calories", "is", null);
  const daysWithMacroTarget = macroRows?.length ?? 0;

  const { data: weightLogs } = await supabase
    .from("body_weight_logs")
    .select("id, logged_date, weight")
    .eq("athlete_id", params.athleteId)
    .eq("group_id", params.groupId)
    .order("logged_date", { ascending: false })
    .limit(20);

  const weightTrend = computeWeeklyWeightTrend(
    (weightLogs ?? []).map((w) => ({ loggedDate: w.logged_date, weight: w.weight })),
    todayKey
  );

  // Every real logged set for this client, grouped into a per-exercise
  // trend — this is what "see a graph of your progress" is actually built
  // from: no separate schema, every set already carries its own
  // completed_at timestamp. New exercises show up here automatically the
  // first time they're logged, with no setup needed. Capped generously
  // (500 rows) rather than unbounded, same caution as the workout-history
  // list above.
  const { data: exerciseHistoryRows } = await supabase
    .from("set_logs")
    .select(
      "weight, completed_at, session_exercises!inner ( exercise_name, session_id, athlete_sessions!inner ( athlete_id, group_id ) )"
    )
    .eq("session_exercises.athlete_sessions.athlete_id", params.athleteId)
    .eq("session_exercises.athlete_sessions.group_id", params.groupId)
    .eq("status", "completed")
    .not("weight", "is", null)
    .order("completed_at", { ascending: true })
    .limit(500);

  const progressionByExercise = new Map<string, Map<string, number>>();
  for (const row of (exerciseHistoryRows ?? []) as any[]) {
    const name = row.session_exercises.exercise_name;
    const date = (row.completed_at as string).slice(0, 10);
    const weight = row.weight as number;
    const byDate = progressionByExercise.get(name) ?? new Map<string, number>();
    // Best set of the day per exercise, same "session best" convention PR
    // detection already uses — several sets the same day collapse to one
    // point instead of a jagged same-day zig-zag.
    if (!byDate.has(date) || weight > byDate.get(date)!) {
      byDate.set(date, weight);
    }
    progressionByExercise.set(name, byDate);
  }
  const progressionData: Record<string, { date: string; value: number }[]> = {};
  for (const [name, byDate] of progressionByExercise) {
    progressionData[name] = Array.from(byDate.entries())
      .map(([date, value]) => ({ date, value }))
      .sort((a, b) => a.date.localeCompare(b.date));
  }

  // Coach-set calorie targets over time — deliberately the target, not
  // actual intake, since nothing in this app logs what a client really
  // ate. Reads clean because daily_macros is one row per real calendar
  // day (upserted, never duplicated) — clearing a day via the new "Clear
  // this day" control removes it here too, so a coach testing numbers
  // doesn't leave a fake point behind.
  const { data: calorieRows } = await supabase
    .from("daily_macros")
    .select("log_date, calories")
    .eq("athlete_id", params.athleteId)
    .eq("group_id", params.groupId)
    .not("calories", "is", null)
    .order("log_date", { ascending: true });
  const calorieTrend = (calorieRows ?? []).map((r) => ({ date: r.log_date, value: r.calories as number }));

  const thirtyDaysAgoKey = (() => {
    const d = new Date();
    d.setDate(d.getDate() - 30);
    return d.toISOString().slice(0, 10);
  })();

  const { data: ouraConnection } = await supabase
    .from("wearable_connections")
    .select("id")
    .eq("profile_id", params.athleteId)
    .eq("provider", "oura")
    .maybeSingle();

  const { data: wearableMetrics } = ouraConnection
    ? await supabase
        .from("wearable_daily_metrics")
        .select("metric_date, metric_type, value")
        .eq("connection_id", ouraConnection.id)
        .gte("metric_date", thirtyDaysAgoKey)
    : { data: null };

  const stepsTrend = (wearableMetrics ?? [])
    .filter((m) => m.metric_type === "steps")
    .map((m) => ({ date: m.metric_date, value: m.value }));
  const sleepScoreTrend = (wearableMetrics ?? [])
    .filter((m) => m.metric_type === "sleep_score")
    .map((m) => ({ date: m.metric_date, value: m.value }));

  const { data: existingPlan } = macrosEnabled
    ? await supabase
        .from("meal_plans")
        .select("archetype, meal_count, include_snack, carb_cycling, rationale, macros, meals")
        .eq("athlete_id", params.athleteId)
        .eq("log_date", todayKey)
        .maybeSingle()
    : { data: null };

  const initials = (profile?.full_name ?? "?")
    .split(" ")
    .map((p: string) => p[0])
    .slice(0, 2)
    .join("")
    .toUpperCase();

  return (
    <CoachDesktopShell groupId={params.groupId} groupName={group?.name ?? "Coaching"} active="clients">
      <div className="pb-6 border-b border-steel/20 mb-6">
        <Link
          href={`/groups/${params.groupId}/clients`}
          className="font-body text-xs text-steel uppercase tracking-wide"
        >
          &larr; Back to clients
        </Link>
        <div className="flex items-center gap-3 mt-3">
          {profile?.avatar_url ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={profile.avatar_url}
              alt=""
              className="w-14 h-14 rounded-full object-cover shrink-0"
            />
          ) : (
            <div className="w-14 h-14 rounded-full bg-surface border border-steel/30 flex items-center justify-center shrink-0">
              <span className="font-display text-lg text-chalk">{initials}</span>
            </div>
          )}
          <div>
            <h1 className="font-display font-bold text-2xl leading-none uppercase">
              {profile?.full_name ?? "Unknown"}
            </h1>
            <p className="font-body text-xs text-steel mt-1">
              Joined {new Date(athleteMembership.joined_at).toLocaleDateString()}
            </p>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2 mt-4">
          {activeProgram && (
            <Link
              href={`/groups/${params.groupId}/programs/${activeProgram.id}`}
              className="inline-flex items-center h-9 font-body text-xs text-rust border border-rust px-3"
            >
              Current program: {activeProgram.name}
            </Link>
          )}
          <Link
            href={`/groups/${params.groupId}/athletes/${params.athleteId}/log`}
            className="inline-flex items-center h-9 font-body text-xs text-graphite bg-rust px-3 font-medium"
          >
            Log in-person session
          </Link>
          <Link
            href={`/groups/${params.groupId}/athletes/${params.athleteId}/calendar`}
            className="inline-flex items-center h-9 font-body text-xs text-rust border border-rust px-3"
          >
            Calendar
          </Link>
          <Link
            href={`/groups/${params.groupId}/calendar?client=${params.athleteId}`}
            className="inline-flex items-center h-9 font-body text-xs text-graphite bg-rust px-3 font-medium"
          >
            Schedule session
          </Link>
        </div>
      </div>

      <div className="grid grid-cols-[320px_1fr] gap-10 items-start">
        <div className="space-y-8">
          <section>
            <h2 className="font-display uppercase text-sm tracking-wide text-steel mb-2">
              Stats
            </h2>
            <div className="flex gap-6 pb-4 border-b border-steel/15">
              <div>
                <p className="font-display text-2xl">{totalCompleted}</p>
                <p className="font-body text-xs text-steel">Workouts</p>
              </div>
              <div>
                <p className="font-display text-2xl">
                  {Math.round(totalVolume).toLocaleString()}
                </p>
                <p className="font-body text-xs text-steel">Volume (lbs)</p>
              </div>
              <div>
                <p className="font-display text-2xl">{prEntries.length}</p>
                <p className="font-body text-xs text-steel">PRs</p>
              </div>
            </div>

            {prEntries.length > 0 && (
              <div className="py-4 border-b border-steel/15">
                <h3 className="font-body text-xs text-steel uppercase tracking-wide mb-2">
                  Recent PRs
                </h3>
                <div className="space-y-1">
                  {prEntries.slice(0, 8).map((pr, i) => (
                    <p key={i} className="font-body text-sm">
                      {pr.exerciseName}{" "}
                      <span className="text-steel text-xs">
                        &middot; {new Date(pr.date).toLocaleDateString()}
                      </span>
                    </p>
                  ))}
                </div>
              </div>
            )}
          </section>

          {(activeHabits.length > 0 || daysWithMacroTarget > 0) && (
            <section>
              <h2 className="font-display uppercase text-sm tracking-wide text-steel mb-2">
                Last 7 Days
              </h2>
              <div className="pb-4 border-b border-steel/15 space-y-3">
                {activeHabits.length > 0 && (
                  <div>
                    <p className="font-body text-sm">
                      Habits:{" "}
                      <span className="font-medium">
                        {totalHabitsCompleted}/{totalHabitsDue}
                      </span>{" "}
                      check-ins
                      {totalHabitsDue > 0 && (
                        <span className="text-steel">
                          {" "}
                          ({Math.round((totalHabitsCompleted / totalHabitsDue) * 100)}%)
                        </span>
                      )}
                    </p>
                    <div className="mt-1 space-y-0.5">
                      {habitCompliance.map((h) => (
                        <p key={h.title} className="font-body text-xs text-steel">
                          {h.title}: {h.completed}/{h.due}
                        </p>
                      ))}
                    </div>
                  </div>
                )}
                <p className="font-body text-sm text-steel">
                  Macro targets set: {daysWithMacroTarget}/7 days
                  <span className="block text-xs mt-0.5">
                    (tracks whether a target was set — actual intake isn&apos;t logged yet)
                  </span>
                </p>
              </div>
            </section>
          )}

          <section>
            <SessionCreditsControl
              athleteId={params.athleteId}
              groupId={params.groupId}
              initialBalance={creditsRow?.balance ?? 0}
            />
          </section>

          <section>
            <PackageAssignmentControl
              athleteId={params.athleteId}
              privatePackages={(privatePackageRows ?? []).map((p) => ({
                id: p.id,
                name: p.name,
                sessionsPerWeek: p.sessions_per_week,
                rateCents: p.rate_cents,
                sessionsGranted: p.sessions_granted,
              }))}
              initialAssignedIds={assignedPackageIds}
            />
          </section>

          <section>
            <PrivateFromOrgToggle
              athleteId={params.athleteId}
              groupId={params.groupId}
              initialValue={athleteMembership.private_from_org ?? false}
            />
          </section>

          <section>
            <h2 className="font-display uppercase text-sm tracking-wide text-steel mb-2">
              Coach notes
            </h2>
            <AthleteNotesEditor
              athleteId={params.athleteId}
              groupId={params.groupId}
              noteId={noteRow?.id ?? null}
              initialBody={noteRow?.body ?? ""}
            />
          </section>

          <section>
            <h2 className="font-display uppercase text-sm tracking-wide text-steel mb-2">
              Body weight
            </h2>
            <TrendChart
              points={(weightLogs ?? [])
                .slice()
                .reverse()
                .map((w) => ({ date: w.logged_date, value: w.weight }))}
              unit=" lbs"
            />
            {weightLogs && weightLogs.length > 0 ? (
              <div className="divide-y divide-steel/15 mt-2">
                {weightLogs.map((w) => (
                  <div key={w.id} className="py-2 flex items-center justify-between">
                    <span className="font-body text-sm text-steel">
                      {new Date(w.logged_date + "T00:00:00").toLocaleDateString()}
                    </span>
                    <span className="font-body text-sm">{w.weight} lbs</span>
                  </div>
                ))}
              </div>
            ) : (
              <p className="font-body text-sm text-steel py-2">No weight logged yet.</p>
            )}
          </section>

          {ouraConnection && (
            <section>
              <h2 className="font-display uppercase text-sm tracking-wide text-steel mb-2">
                Sleep &amp; Steps
              </h2>
              <div className="space-y-4 pb-2">
                <div>
                  <p className="font-body text-xs text-steel uppercase tracking-wide mb-2">Steps</p>
                  <TrendChart points={stepsTrend} emptyLabel="No steps synced yet." />
                </div>
                <div>
                  <p className="font-body text-xs text-steel uppercase tracking-wide mb-2">
                    Sleep score
                  </p>
                  <TrendChart points={sleepScoreTrend} emptyLabel="No sleep data synced yet." />
                </div>
              </div>
            </section>
          )}
        </div>

        <div>
          <section>
            <h2 className="font-display uppercase text-sm tracking-wide text-steel mb-2">
              Progress
            </h2>
            <div className="grid grid-cols-2 gap-8 pb-6 mb-6 border-b border-steel/15">
              <div>
                <p className="font-body text-xs text-steel uppercase tracking-wide mb-2">
                  Exercise
                </p>
                <ExerciseProgressionChart progressionData={progressionData} />
              </div>
              <div>
                <p className="font-body text-xs text-steel uppercase tracking-wide mb-2">
                  Calorie target
                </p>
                <TrendChart
                  points={calorieTrend}
                  unit=" cal"
                  emptyLabel="No calorie targets set yet."
                />
              </div>
            </div>
          </section>

          <section>
          <h2 className="font-display uppercase text-sm tracking-wide text-steel mb-2">
            Logged workouts
            {totalCompleted > RECENT_LOGS_LIMIT && (
              <span className="normal-case text-steel">
                {" "}
                — most recent {RECENT_LOGS_LIMIT} of {totalCompleted}
              </span>
            )}
          </h2>
          {workoutLogs.length === 0 ? (
            <p className="font-body text-sm text-steel py-2">No completed workouts yet.</p>
          ) : (
            <div className="divide-y divide-steel/15">
              {workoutLogs.map((log: any) => (
                <div key={log.id} className="py-3">
                  <div className="flex items-center justify-between gap-2">
                    <span className="font-body font-medium text-[15px] flex items-center gap-2">
                      {log.workouts?.title ?? "Workout"}
                      {log.logged_by_coach && <CoachLoggedBadge />}
                    </span>
                    <span className="font-body text-xs text-steel shrink-0">
                      {new Date(log.created_at).toLocaleDateString()}
                    </span>
                  </div>
                  <p className="font-body text-xs text-steel mt-0.5">
                    {log.total_sets_completed} sets &middot;{" "}
                    {Math.round(log.total_volume ?? 0).toLocaleString()} lbs volume
                    {log.new_prs?.length > 0 && (
                      <span className="text-rust"> &middot; PR: {log.new_prs.join(", ")}</span>
                    )}
                  </p>
                </div>
              ))}
            </div>
          )}
          </section>
        </div>
      </div>

      {macrosEnabled && (
        <section className="border-t border-steel/20 pt-6 mt-8 max-w-3xl">
          <h2 className="font-display uppercase text-sm tracking-wide text-steel mb-3">
            Nutrition
          </h2>
          <NutritionTools
            athleteId={params.athleteId}
            groupId={params.groupId}
            date={todayKey}
            latestBodyWeight={weightLogs?.[0]?.weight ?? null}
            weightTrend={weightTrend}
            existingPlan={existingPlan ?? null}
          />
        </section>
      )}
    </CoachDesktopShell>
  );
}
