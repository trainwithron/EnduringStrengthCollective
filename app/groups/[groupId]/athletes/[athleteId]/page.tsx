import Link from "next/link";
import { redirect } from "next/navigation";
import { createServerClient } from "@/lib/supabase/server";
import { CoachDesktopShell } from "@/components/coach/coach-desktop-shell";
import { AthleteNotesEditor } from "@/components/coach/athlete-notes-editor";
import { SessionCreditsControl } from "@/components/coach/session-credits-control";
import { SwipeDirectionSetting } from "@/components/athlete/swipe-direction-setting";
import { GoalConfirmationControl } from "@/components/coach/goal-confirmation-control";
import { PackageAssignmentControl } from "@/components/coach/package-assignment-control";
import { PrivateFromOrgToggle } from "@/components/coach/private-from-org-toggle";
import { ChangeClientGroupControl } from "@/components/coach/change-client-group-control";
import { ClientProgrammingMenu } from "@/components/coach/client-programming-menu";
import { MinorConsentControl } from "@/components/coach/minor-consent-control";
import { NutritionPhaseControl } from "@/components/coach/nutrition-phase-control";
import { VideoCheckinRecorder } from "@/components/coach/video-checkin-recorder";
import { ParQAnswersPanel } from "@/components/coach/par-q-answers-panel";
import { RosterSection } from "@/components/coach/desktop/roster-section";
import { isUnder13 } from "@/lib/coppa";
import { CoachLoggedBadge } from "@/components/coach-logged-badge";
import { NutritionTools } from "@/components/coach/desktop/nutrition-tools";
import { TrendChart } from "@/components/coach/desktop/trend-chart";
import { ExerciseProgressionChart } from "@/components/coach/desktop/exercise-progression-chart";
import { isHabitDueOn, computeCompliancePct } from "@/lib/habits";
import { computeQuietTier } from "@/lib/quiet-client-tier";
import { isLowReadiness } from "@/lib/wellness";
import { computeWeeklyWeightTrend } from "@/lib/weight-trend";
import { deriveEventWindow, weeksUntilEvent, isWithinTaperWindow } from "@/lib/event-window";
import { currentTaperMultiplier } from "@/lib/endurance-taper";
import {
  classifyNutritionTrend,
  isTrendAligned,
  type NutritionPhase,
} from "@/lib/nutrition-trend-classifier";

export default async function AthleteProfilePage(
  props: {
    params: Promise<{ groupId: string; athleteId: string }>;
  }
) {
  const params = await props.params;
  const supabase = await createServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect("/login");
  }

  // Wave 1 — every one of these 23 queries depends only on `params`/
  // `user.id`, not on each other, so they run as one batch instead of
  // 23 sequential round trips. This page had grown to the worst
  // sequential-query count in the whole app (a client profile a coach
  // opens constantly, right before/after logging a session); this is
  // the real fix, same pattern already proven on the Calendar and
  // session-logging pages. `existingPlan` can't join this batch — it's
  // gated on `macrosEnabled`, which itself depends on this batch's own
  // `athleteMembership` result — so it moves to wave 2 below.
  const [
    { data: membership },
    { data: athleteMembership },
    { data: group },
    { data: personalProgram },
    { data: sharedProgramRaw },
    { data: allLogs },
    { data: noteRow },
    { data: creditsRow },
    { data: nutritionPhaseRow },
    { data: latestGoalRow },
    { data: sharedPhotoRows },
    { data: intake },
    { data: profileDetails },
    { data: privatePackageRows },
    { data: habitRows },
    { data: weightLogs },
    { data: exerciseHistoryRows },
    { data: calorieRows },
    { data: ouraConnection },
    { data: withingsConnection },
    { data: wellnessRows },
    { data: trainingMaxRows },
    { data: latestConfirmedEventGoal },
  ] = await Promise.all([
    supabase
      .from("group_memberships")
      .select("role")
      .eq("group_id", params.groupId)
      .eq("profile_id", user.id)
      .maybeSingle(),
    supabase
      .from("group_memberships")
      .select(
        "joined_at, client_tier, private_from_org, profiles ( id, full_name, avatar_url, exercise_swipe_direction )"
      )
      .eq("group_id", params.groupId)
      .eq("profile_id", params.athleteId)
      .maybeSingle(),
    supabase.from("groups").select("name").eq("id", params.groupId).single(),
    // This client's own personal program wins over the group's shared
    // one — same precedence as lib/todays-workout.ts. Both queries run
    // unconditionally rather than fetching shared only when personal
    // comes back empty — at most one extra, cheap row in the common
    // case, in exchange for removing a real sequential round trip.
    supabase
      .from("programs")
      .select("id, name")
      .eq("group_id", params.groupId)
      .eq("athlete_id", params.athleteId)
      .eq("is_active", true)
      .maybeSingle(),
    supabase
      .from("programs")
      .select("id, name")
      .eq("group_id", params.groupId)
      .is("athlete_id", null)
      .eq("is_active", true)
      .maybeSingle(),
    // Stats (total count, volume, PRs) need every logged workout to
    // stay accurate, and the displayed history below is just the first
    // 50 of this same, already-descending-ordered list — one query
    // serves both instead of fetching workout_logs twice.
    supabase
      .from("workout_logs")
      .select(
        "id, session_id, total_volume, total_sets_completed, new_prs, created_at, logged_by_coach, workouts ( title, week_number, day_index )"
      )
      .eq("athlete_id", params.athleteId)
      .eq("group_id", params.groupId)
      .order("created_at", { ascending: false }),
    supabase
      .from("athlete_notes")
      .select("id, body")
      .eq("athlete_id", params.athleteId)
      .eq("group_id", params.groupId)
      .maybeSingle(),
    supabase
      .from("session_credits")
      .select("balance")
      .eq("athlete_id", params.athleteId)
      .eq("group_id", params.groupId)
      .maybeSingle(),
    supabase
      .from("nutrition_phases")
      .select("phase, started_at")
      .eq("athlete_id", params.athleteId)
      .eq("group_id", params.groupId)
      .maybeSingle(),
    // Goal-date-aware nutrition/programming — the client always
    // proposes, the coach confirms. Only the most recent goal matters
    // here — an older one is history, shown on the client's own /goal
    // page, not repeated on this profile.
    supabase
      .from("client_goals")
      .select("id, goal_type, custom_label, target_date, priority_note, status")
      .eq("athlete_id", params.athleteId)
      .eq("group_id", params.groupId)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle(),
    // Transformation Cards — only the specific photos this athlete has
    // explicitly chosen to share, never the full private journal. RLS
    // already enforces this, this query just matches that same filter.
    supabase
      .from("progress_photos")
      .select("id, storage_path, taken_date")
      .eq("athlete_id", params.athleteId)
      .eq("group_id", params.groupId)
      .eq("shared_with_coach", true)
      .order("taken_date", { ascending: false }),
    supabase
      .from("client_intake")
      .select("date_of_birth, par_q_answers, waiver_accepted, waiver_signed_name, completed_at")
      .eq("athlete_id", params.athleteId)
      .maybeSingle(),
    // Self-reported by the athlete in their own Settings — RLS already
    // scopes this to "self or a coach who actually coaches them."
    supabase
      .from("athlete_profile_details")
      .select("bio, birthday, phone, emergency_contact_name, emergency_contact_phone")
      .eq("athlete_id", params.athleteId)
      .maybeSingle(),
    // Published packages need no assignment — every client already
    // sees them — so only private ones are relevant to assign here.
    supabase
      .from("coach_packages")
      .select("id, name, sessions_per_week, rate_cents, sessions_granted")
      .eq("group_id", params.groupId)
      .eq("is_active", true)
      .eq("is_public", false)
      .order("sessions_per_week", { ascending: true }),
    supabase
      .from("client_habits")
      .select("id, title, weekdays")
      .eq("athlete_id", params.athleteId)
      .eq("group_id", params.groupId)
      .eq("active", true),
    supabase
      .from("body_weight_logs")
      .select("id, logged_date, weight")
      .eq("athlete_id", params.athleteId)
      .eq("group_id", params.groupId)
      .order("logged_date", { ascending: false })
      .limit(20),
    // Every real logged set for this client, grouped into a per-
    // exercise trend — no separate schema, every set already carries
    // its own completed_at timestamp. Capped generously (500 rows)
    // rather than unbounded, same caution as the workout-history list.
    supabase
      .from("set_logs")
      .select(
        "weight, completed_at, session_exercises!inner ( exercise_name, session_id, athlete_sessions!inner ( athlete_id, group_id ) )"
      )
      .eq("session_exercises.athlete_sessions.athlete_id", params.athleteId)
      .eq("session_exercises.athlete_sessions.group_id", params.groupId)
      .eq("status", "completed")
      .not("weight", "is", null)
      .order("completed_at", { ascending: true })
      .limit(500),
    // Coach-set calorie targets over time — deliberately the target,
    // not actual intake, since nothing in this app logs what a client
    // really ate.
    supabase
      .from("daily_macros")
      .select("log_date, calories")
      .eq("athlete_id", params.athleteId)
      .eq("group_id", params.groupId)
      .not("calories", "is", null)
      .order("log_date", { ascending: true }),
    supabase
      .from("wearable_connections")
      .select("id")
      .eq("profile_id", params.athleteId)
      .eq("provider", "oura")
      .maybeSingle(),
    supabase
      .from("wearable_connections")
      .select("id")
      .eq("profile_id", params.athleteId)
      .eq("provider", "withings")
      .maybeSingle(),
    supabase
      .from("wellness_checkins")
      .select("log_date, sleep_quality, soreness, energy")
      .eq("athlete_id", params.athleteId)
      .eq("group_id", params.groupId)
      .gte("log_date", (() => {
        const d = new Date();
        d.setDate(d.getDate() - 30);
        return d.toISOString().slice(0, 10);
      })())
      .order("log_date", { ascending: true }),
    // AI Program Builder methodology grounding — real, persisted
    // training maxes, auto-estimated from logged sets. Read-only here.
    supabase
      .from("athlete_training_maxes")
      .select("exercise_name, estimated_max, updated_at")
      .eq("athlete_id", params.athleteId)
      .order("updated_at", { ascending: false }),
    // Peaking & Tapering — the shared event_window object, read here
    // just to surface a real "you're in taper" notice.
    supabase
      .from("client_goals")
      .select("status, target_date, event_type, event_expected_duration_minutes, event_priority, weight_class_flag")
      .eq("athlete_id", params.athleteId)
      .eq("group_id", params.groupId)
      .eq("status", "confirmed")
      .not("target_date", "is", null)
      .not("event_type", "is", null)
      .order("confirmed_at", { ascending: false })
      .limit(1)
      .maybeSingle(),
  ]);

  if (membership?.role !== "coach") {
    return (
      <main className="min-h-screen bg-graphite text-chalk flex items-center justify-center px-6">
        <p className="font-body text-steel text-center">
          Only coaches can view client profiles.
        </p>
      </main>
    );
  }

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

  const sharedProgram = personalProgram ? null : sharedProgramRaw;
  const activeProgram = personalProgram ?? sharedProgram;
  const isMinor = !!intake?.date_of_birth && isUnder13(intake.date_of_birth, new Date());
  const todayKeyForWave2 = new Date().toISOString().slice(0, 10);

  // Wave 2 — each of these depends on a wave-1 result (or a pure JS
  // value derived from one), but not on each other, so they run as one
  // more batch instead of ~8 more sequential round trips.
  const [
    { data: activeProgramSchedule },
    { data: minorConsentRow },
    { data: assignmentRows },
    { data: habitLogRows },
    signedPhotoResults,
    nutritionTrendInputs,
    { data: wearableMetrics },
    { data: withingsMetrics },
    { data: existingPlan },
  ] = await Promise.all([
    activeProgram
      ? supabase.from("programs").select("training_days").eq("id", activeProgram.id).maybeSingle()
      : Promise.resolve({ data: null }),
    isMinor
      ? supabase
          .from("minor_consent")
          .select("verified, method, notes, verified_at")
          .eq("athlete_id", params.athleteId)
          .maybeSingle()
      : Promise.resolve({ data: null }),
    supabase
      .from("package_assignments")
      .select("coach_package_id")
      .eq("athlete_id", params.athleteId)
      .in("coach_package_id", (privatePackageRows ?? []).map((p) => p.id)),
    supabase
      .from("habit_logs")
      .select("habit_id, log_date, completed_at")
      .in("habit_id", (habitRows ?? []).map((h) => h.id))
      .gte(
        "log_date",
        (() => {
          const d = new Date();
          d.setDate(d.getDate() - 6);
          return d.toISOString().slice(0, 10);
        })()
      )
      .lte("log_date", todayKeyForWave2),
    Promise.all(
      (sharedPhotoRows ?? []).map(async (p) => {
        const { data: signed } = await supabase.storage
          .from("progress-photos")
          .createSignedUrl(p.storage_path, 3600);
        return { id: p.id, takenDate: p.taken_date, signedUrl: signed?.signedUrl ?? null };
      })
    ),
    // Category 2 (Milestone Celebrations) — a live "does the trend
    // actually match the tagged goal" read, computed fresh on every
    // page load. Only queried when a phase is actually tagged.
    nutritionPhaseRow?.phase
      ? (async () => {
          const sixWeeksAgo = new Date();
          sixWeeksAgo.setDate(sixWeeksAgo.getDate() - 42);
          const sixWeeksAgoKey = sixWeeksAgo.toISOString().slice(0, 10);
          const [{ data: macroRows }, { data: weightRowsForTrend }] = await Promise.all([
            supabase
              .from("daily_macros")
              .select("log_date, calories")
              .eq("athlete_id", params.athleteId)
              .eq("group_id", params.groupId)
              .gte("log_date", sixWeeksAgoKey),
            supabase
              .from("body_weight_logs")
              .select("logged_date, weight")
              .eq("athlete_id", params.athleteId)
              .eq("group_id", params.groupId)
              .gte("logged_date", sixWeeksAgoKey),
          ]);
          return { macroRows, weightRowsForTrend };
        })()
      : Promise.resolve({ macroRows: null, weightRowsForTrend: null }),
    ouraConnection
      ? supabase
          .from("wearable_daily_metrics")
          .select("metric_date, metric_type, value")
          .eq("connection_id", ouraConnection.id)
          .gte(
            "metric_date",
            (() => {
              const d = new Date();
              d.setDate(d.getDate() - 30);
              return d.toISOString().slice(0, 10);
            })()
          )
      : Promise.resolve({ data: null }),
    withingsConnection
      ? supabase
          .from("wearable_daily_metrics")
          .select("metric_date, value")
          .eq("connection_id", withingsConnection.id)
          .eq("metric_type", "weight")
          .gte(
            "metric_date",
            (() => {
              const d = new Date();
              d.setDate(d.getDate() - 30);
              return d.toISOString().slice(0, 10);
            })()
          )
      : Promise.resolve({ data: null }),
    macrosEnabled
      ? supabase
          .from("meal_plans")
          .select("archetype, meal_count, include_snack, carb_cycling, rationale, macros, meals")
          .eq("athlete_id", params.athleteId)
          .eq("log_date", todayKeyForWave2)
          .maybeSingle()
      : Promise.resolve({ data: null }),
  ]);

  const sharedPhotos = signedPhotoResults;
  let nutritionTrendAlignment: {
    trend: string;
    aligned: boolean;
    calorieChangePct: number;
    weightChangePct: number;
  } | null = null;
  if (nutritionPhaseRow?.phase) {
    const calorieSeries = (nutritionTrendInputs.macroRows ?? [])
      .filter((r) => r.calories != null)
      .map((r) => ({ date: r.log_date as string, value: r.calories as number }));
    const weightSeries = (nutritionTrendInputs.weightRowsForTrend ?? []).map((r) => ({
      date: r.logged_date as string,
      value: r.weight as number,
    }));
    const classification = classifyNutritionTrend(calorieSeries, weightSeries, new Date());
    if (classification) {
      nutritionTrendAlignment = {
        trend: classification.trend,
        aligned: isTrendAligned(classification, nutritionPhaseRow.phase as NutritionPhase),
        calorieChangePct: classification.calorieChangePct,
        weightChangePct: classification.weightChangePct,
      };
    }
  }

  const parQAnswers = (intake?.par_q_answers as { question: string; answer: boolean }[]) ?? [];
  const parQFlaggedCount = parQAnswers.filter((a) => a.answer).length;
  const hasAboutInfo = !!(
    profileDetails?.bio ||
    profileDetails?.birthday ||
    profileDetails?.phone ||
    profileDetails?.emergency_contact_name
  );
  const assignedPackageIds = (assignmentRows ?? []).map((a) => a.coach_package_id);

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
  const workoutLogs = (allLogs ?? []).slice(0, RECENT_LOGS_LIMIT);

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

  const activeHabits = habitRows ?? [];

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
  const calorieTrend = (calorieRows ?? []).map((r) => ({ date: r.log_date, value: r.calories as number }));
  // Same rows as above, just the last-7-days slice — one query serves
  // both instead of a second round trip against the same table/filter.
  const daysWithMacroTarget = (calorieRows ?? []).filter(
    (r) => r.log_date >= weekStartKey && r.log_date <= todayKey
  ).length;

  const thirtyDaysAgoKey = (() => {
    const d = new Date();
    d.setDate(d.getDate() - 30);
    return d.toISOString().slice(0, 10);
  })();

  const stepsTrend = (wearableMetrics ?? [])
    .filter((m) => m.metric_type === "steps")
    .map((m) => ({ date: m.metric_date, value: m.value }));
  const sleepScoreTrend = (wearableMetrics ?? [])
    .filter((m) => m.metric_type === "sleep_score")
    .map((m) => ({ date: m.metric_date, value: m.value }));

  const withingsWeightTrend = (withingsMetrics ?? []).map((m) => ({ date: m.metric_date, value: m.value }));

  const eventWindow = latestConfirmedEventGoal
    ? deriveEventWindow({
        status: latestConfirmedEventGoal.status,
        targetDate: latestConfirmedEventGoal.target_date,
        eventType: latestConfirmedEventGoal.event_type,
        eventExpectedDurationMinutes: latestConfirmedEventGoal.event_expected_duration_minutes,
        eventPriority: latestConfirmedEventGoal.event_priority as "A" | "B" | "C" | null,
        weightClassFlag: latestConfirmedEventGoal.weight_class_flag,
      })
    : null;
  const ENDURANCE_TAPER_WEEKS = 2;
  const todayDate = new Date();
  const weeksOut = eventWindow ? weeksUntilEvent(eventWindow, todayDate) : null;
  const inTaperWindow = eventWindow ? isWithinTaperWindow(eventWindow, todayDate, ENDURANCE_TAPER_WEEKS) : false;
  const taperMultiplier =
    eventWindow && weeksOut !== null ? currentTaperMultiplier(weeksOut, ENDURANCE_TAPER_WEEKS) : null;
  const sleepQualityTrend = (wellnessRows ?? []).map((r) => ({ date: r.log_date, value: r.sleep_quality }));
  const sorenessTrend = (wellnessRows ?? []).map((r) => ({ date: r.log_date, value: r.soreness }));
  const energyTrend = (wellnessRows ?? []).map((r) => ({ date: r.log_date, value: r.energy }));

  const initials = (profile?.full_name ?? "?")
    .split(" ")
    .map((p: string) => p[0])
    .slice(0, 2)
    .join("")
    .toUpperCase();

  // Single-athlete flag banner — same signals/priority as Home's hero
  // (readiness > quiet tier > habits), scoped to just this one client.
  const todaysWellnessRow = (wellnessRows ?? []).find((r) => r.log_date === todayKey);
  const lastLoggedAt = allLogs?.[0]?.created_at ?? null;
  const quietTier = computeQuietTier({
    lastLoggedAt: lastLoggedAt ? new Date(lastLoggedAt) : null,
    now: new Date(),
    trainingDays: activeProgramSchedule?.training_days ?? null,
  });
  const habitCompliancePct = computeCompliancePct(totalHabitsCompleted, totalHabitsDue);

  let profileFlag: string | null = null;
  if (
    todaysWellnessRow &&
    isLowReadiness({
      sleepQuality: todaysWellnessRow.sleep_quality,
      soreness: todaysWellnessRow.soreness,
      energy: todaysWellnessRow.energy,
    })
  ) {
    profileFlag = "Logged low readiness today.";
  } else if (quietTier === "strong") {
    profileFlag = "Has gone quiet — worth a personal check-in.";
  } else if (quietTier === "mild") {
    profileFlag = "Hasn't logged in a while.";
  } else if (habitCompliancePct != null && habitCompliancePct < 50) {
    profileFlag = `Missed ${totalHabitsDue - totalHabitsCompleted} habit${totalHabitsDue - totalHabitsCompleted === 1 ? "" : "s"} this week.`;
  }

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
        {profileFlag && (
          <p className="font-body text-xs text-rust border border-rust/40 bg-rust/5 px-3 py-1.5 mt-3 inline-block">
            {profileFlag}
          </p>
        )}
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
          <ClientProgrammingMenu
            groupId={params.groupId}
            athleteId={params.athleteId}
            athleteFullName={profile?.full_name ?? "Client"}
          />
          <Link
            href={`/groups/${params.groupId}/athletes/${params.athleteId}/calendar`}
            className="inline-flex items-center h-9 font-body text-xs text-rust border border-rust px-3"
          >
            Calendar
          </Link>
          <VideoCheckinRecorder athleteId={params.athleteId} groupId={params.groupId} coachId={user.id} />
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
          {(hasAboutInfo || parQAnswers.length > 0) && (
            <RosterSection
              title="Personal Info"
              summary={
                parQFlaggedCount > 0
                  ? `Bio, contact & health screening (${parQFlaggedCount} flagged)`
                  : "Bio, contact & health screening"
              }
              needsAttentionCount={parQFlaggedCount}
              defaultExpanded={parQFlaggedCount > 0}
            >
              <div className="space-y-4">
                {hasAboutInfo && (
                  <div>
                    {profileDetails?.bio && (
                      <p className="font-body text-sm text-chalk mb-2">{profileDetails.bio}</p>
                    )}
                    <div className="font-body text-xs text-steel space-y-0.5">
                      {profileDetails?.birthday && (
                        <p>Birthday: {new Date(`${profileDetails.birthday}T00:00:00`).toLocaleDateString()}</p>
                      )}
                      {profileDetails?.phone && <p>Phone: {profileDetails.phone}</p>}
                      {profileDetails?.emergency_contact_name && (
                        <p>
                          Emergency contact: {profileDetails.emergency_contact_name}
                          {profileDetails?.emergency_contact_phone && ` · ${profileDetails.emergency_contact_phone}`}
                        </p>
                      )}
                    </div>
                  </div>
                )}
                {parQAnswers.length > 0 && <ParQAnswersPanel answers={parQAnswers} />}
              </div>
            </RosterSection>
          )}
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

          {sharedPhotos.length > 0 && (
            <section>
              <h2 className="font-display uppercase text-sm tracking-wide text-steel mb-2">
                Progress Photos Shared With You
              </h2>
              <div className="grid grid-cols-3 sm:grid-cols-4 gap-2">
                {sharedPhotos.map((photo) => (
                  <div key={photo.id}>
                    {photo.signedUrl && (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img
                        src={photo.signedUrl}
                        alt=""
                        className="w-full aspect-square object-cover"
                      />
                    )}
                    <p className="font-body text-[10px] text-steel mt-1">
                      {new Date(`${photo.takenDate}T00:00:00`).toLocaleDateString(undefined, {
                        month: "short",
                        day: "numeric",
                      })}
                    </p>
                  </div>
                ))}
              </div>
            </section>
          )}

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

          {(wellnessRows ?? []).length > 0 && (
            <RosterSection title="Wellness" summary="Sleep, soreness & energy trends">
              <div className="space-y-4 pb-2">
                <div>
                  <p className="font-body text-xs text-steel uppercase tracking-wide mb-2">
                    Sleep quality
                  </p>
                  <TrendChart
                    points={sleepQualityTrend}
                    emptyLabel="Only checked in once so far — needs a second check-in to chart a trend."
                  />
                </div>
                <div>
                  <p className="font-body text-xs text-steel uppercase tracking-wide mb-2">
                    Soreness (higher = fresher)
                  </p>
                  <TrendChart
                    points={sorenessTrend}
                    emptyLabel="Only checked in once so far — needs a second check-in to chart a trend."
                  />
                </div>
                <div>
                  <p className="font-body text-xs text-steel uppercase tracking-wide mb-2">Energy</p>
                  <TrendChart
                    points={energyTrend}
                    emptyLabel="Only checked in once so far — needs a second check-in to chart a trend."
                  />
                </div>
              </div>
            </RosterSection>
          )}

          {(trainingMaxRows ?? []).length > 0 && (
            <section>
              <h2 className="font-display uppercase text-sm tracking-wide text-steel mb-2">
                Estimated Training Maxes
              </h2>
              <p className="font-body text-[11px] text-steel mb-2">
                Auto-estimated from logged sets (weight, reps, and RPE) — never a typed-in number, and only ever
                moves up as a harder set gets logged.
              </p>
              <div className="divide-y divide-steel/15">
                {(trainingMaxRows ?? []).map((row) => (
                  <div key={row.exercise_name} className="flex items-center justify-between py-2">
                    <span className="font-body text-sm">{row.exercise_name}</span>
                    <span className="font-body text-sm text-rust font-medium">
                      {Math.round(row.estimated_max)} lbs
                    </span>
                  </div>
                ))}
              </div>
            </section>
          )}

          {eventWindow && inTaperWindow && (
            <section>
              <h2 className="font-display uppercase text-sm tracking-wide text-steel mb-2">
                Event Taper
              </h2>
              <div className="border border-rust/30 bg-surface px-4 py-3">
                <p className="font-body text-sm text-chalk">
                  {weeksOut === 0
                    ? `Race week for ${eventWindow.sportType ?? "their event"} — target date ${eventWindow.targetDate}.`
                    : `${weeksOut} week${weeksOut === 1 ? "" : "s"} out from ${eventWindow.sportType ?? "their event"} (${eventWindow.targetDate}).`}
                </p>
                <p className="font-body text-xs text-steel mt-1">
                  Recommended training volume this week: {Math.round((taperMultiplier ?? 1) * 100)}% of normal —
                  intensity/pace stays exactly where it is, only volume comes down.
                </p>
                <p className="font-body text-xs text-steel mt-1">
                  Nutrition note: don&apos;t cut calories to match the lower training volume this week — carb intake
                  should stay level or increase, not fall with it.
                </p>
                {eventWindow.weightClassFlag && (
                  <p className="font-body text-xs text-rust mt-2">
                    ⚠ Flagged as also cutting weight for a weight class — peaking and cutting at the same time has
                    no real evidence base to automate. Worth a direct conversation, not an automatic plan.
                  </p>
                )}
              </div>
            </section>
          )}

          {isMinor && (
            <section>
              <MinorConsentControl
                athleteId={params.athleteId}
                groupId={params.groupId}
                initialVerified={minorConsentRow?.verified ?? false}
                initialMethod={(minorConsentRow?.method as any) ?? null}
                initialNotes={minorConsentRow?.notes ?? ""}
                initialVerifiedAt={minorConsentRow?.verified_at ?? null}
              />
            </section>
          )}

          {latestGoalRow?.status === "proposed" && (
            <section>
              <GoalConfirmationControl
                goal={{
                  id: latestGoalRow.id,
                  goalType: latestGoalRow.goal_type,
                  customLabel: latestGoalRow.custom_label,
                  targetDate: latestGoalRow.target_date,
                  priorityNote: latestGoalRow.priority_note,
                }}
              />
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
            <SwipeDirectionSetting
              athleteId={params.athleteId}
              label="Exercise logging (set on their behalf)"
              mode="coach"
              initialDirection={
                (profile?.exercise_swipe_direction as "vertical" | "horizontal" | null) ?? null
              }
            />
          </section>

          <section>
            <NutritionPhaseControl
              athleteId={params.athleteId}
              groupId={params.groupId}
              coachId={user.id}
              initialPhase={(nutritionPhaseRow?.phase as NutritionPhase | undefined) ?? null}
              initialStartedAt={nutritionPhaseRow?.started_at ?? null}
            />
            {nutritionTrendAlignment && (
              <p
                className={`font-body text-xs mt-2 ${
                  nutritionTrendAlignment.aligned ? "text-positive" : "text-rust"
                }`}
              >
                {nutritionTrendAlignment.aligned
                  ? "✓ Trending as expected for this phase"
                  : `⚠ Trend reads as "${nutritionTrendAlignment.trend.replace("_", " ")}" — doesn't match the tagged goal yet, worth a look`}
              </p>
            )}
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
            <ChangeClientGroupControl
              athleteId={params.athleteId}
              athleteName={profile?.full_name ?? "This client"}
              currentGroupId={params.groupId}
              currentGroupName={group?.name ?? "this group"}
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

          {withingsConnection && (
            <section>
              <h2 className="font-display uppercase text-sm tracking-wide text-steel mb-2">
                Weight (Withings)
              </h2>
              <p className="font-body text-[11px] text-steel mb-2">
                Auto-synced from a connected scale — separate from the manually-logged weight above.
              </p>
              <div className="pb-2">
                <TrendChart points={withingsWeightTrend} emptyLabel="No weight synced yet." />
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
                  <Link
                    href={log.session_id ? `/sessions/${log.session_id}` : "#"}
                    className="block hover:bg-surface/40 transition-colors"
                  >
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
                  </Link>
                  {log.session_id && (
                    <Link
                      href={`/sessions/${log.session_id}/recap`}
                      className="font-body text-xs text-rust mt-1 inline-block"
                    >
                      Recap &amp; Up Next &rarr;
                    </Link>
                  )}
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
