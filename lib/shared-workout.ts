import { createServerClient } from "@/lib/supabase/server";
import { createServiceRoleClient } from "@/lib/supabase/service-role";
import { estimateOneRepMax } from "@/lib/one-rep-max";
import { computeWeekStreak } from "@/lib/consistency-streak";
import { splitPrsByBaseline } from "@/lib/pr-fatigue";
import { computeHabitCompliance, computeCompliancePct, type HabitLogRow } from "@/lib/habits";
import { shouldShowCompoundCelebration, buildCompoundCelebrationText } from "@/lib/compound-celebration";
import { computeRelativeStrengthMilestone } from "@/lib/relative-strength-milestone";

// Shared by the public /share/[postId] page and the in-feed expanded
// card (fetched via /api/workout-share/[postId]) so both surfaces
// compute "top lifts" / PR list / totals identically from one place.
export async function getSharedWorkout(postId: string) {
  const supabase = await createServerClient();

  const { data: post } = await supabase
    .from("posts")
    .select(
      `
      id, post_type, created_at, group_id, broadcast_level, author_id, shared_exercise_names,
      profiles!posts_author_id_fkey ( full_name ),
      workout_logs ( session_id, new_prs, total_volume, total_sets_completed )
    `
    )
    .eq("id", postId)
    .eq("post_type", "workout_summary")
    .maybeSingle();

  const workoutLog = post?.workout_logs as any;
  if (!post || !workoutLog) return null;

  const { data: group } = await supabase
    .from("groups")
    .select("name")
    .eq("id", post.group_id)
    .maybeSingle();

  const broadcastLevel: "full" | "prs_only" | "checkin_only" = post.broadcast_level ?? "full";
  const newPrs: string[] = broadcastLevel === "checkin_only" ? [] : workoutLog.new_prs ?? [];

  const bestByExercise = new Map<string, { weight: number; reps: number }>();
  if (workoutLog.session_id && broadcastLevel !== "checkin_only") {
    const { data: sets } = await supabase
      .from("set_logs")
      .select("weight, reps, status, session_exercises!inner ( session_id, exercise_name )")
      .eq("session_exercises.session_id", workoutLog.session_id)
      .eq("status", "completed");

    for (const row of (sets ?? []) as any[]) {
      const name = row.session_exercises.exercise_name;
      const weight = row.weight ?? 0;
      const existing = bestByExercise.get(name);
      if (!existing || weight > existing.weight) {
        bestByExercise.set(name, { weight, reps: row.reps ?? 1 });
      }
    }
  }

  const top5Candidates = Array.from(bestByExercise.entries())
    .map(([name, best]) => ({ name, ...best }))
    .sort((a, b) => b.weight - a.weight)
    .slice(0, 5);

  const topLifts =
    broadcastLevel !== "full"
      ? []
      : post.shared_exercise_names
      ? top5Candidates.filter((l) => post.shared_exercise_names!.includes(l.name))
      : top5Candidates.slice(0, 3);

  const prList = newPrs
    .map((name) => {
      const best = bestByExercise.get(name);
      if (!best) return null;
      return {
        name,
        weight: best.weight,
        reps: best.reps,
        oneRepMax: estimateOneRepMax(best.weight, best.reps),
      };
    })
    .filter((x): x is NonNullable<typeof x> => x !== null);

  // Phase 2 (PR-fatigue reframe) — a "PR" on an exercise this athlete has
  // barely touched before isn't a real achievement yet, it's just the
  // only data point that exists. Split the PR list into genuine,
  // celebration-worthy PRs vs. still-establishing-baseline exercises,
  // based on how many OTHER completed sessions (excluding this one)
  // contain this exact exercise name for this athlete — same
  // "exclude current session" pattern used for the obstacle-unlock
  // mechanic's own priorBest computation.
  const priorSessionCountByName = new Map<string, number>();
  if (prList.length > 0 && workoutLog.session_id) {
    // Service-role client, deliberately — this page is genuinely public
    // (see the service-role file-level comment), and the anon PR-share
    // RLS policies only expose rows belonging to THIS specific session,
    // never the athlete's other sessions. A real baseline check needs
    // exactly that other history, which anon can never see. Only ever
    // feeds small derived counts back out, never raw rows — same
    // reasoning already established for weekStreak below.
    const serviceClientForHistory = createServiceRoleClient();
    const { data: priorSessionExerciseRows } = await serviceClientForHistory
      .from("session_exercises")
      .select(
        "session_id, exercise_name, athlete_sessions!inner ( athlete_id ), set_logs!inner ( status )"
      )
      .in(
        "exercise_name",
        prList.map((p) => p.name)
      )
      .eq("set_logs.status", "completed");

    const sessionIdsByName = new Map<string, Set<string>>();
    for (const row of (priorSessionExerciseRows ?? []) as any[]) {
      if (row.session_id === workoutLog.session_id) continue;
      if (row.athlete_sessions?.athlete_id !== post.author_id) continue;
      const name = row.exercise_name;
      if (!sessionIdsByName.has(name)) sessionIdsByName.set(name, new Set());
      sessionIdsByName.get(name)!.add(row.session_id);
    }
    for (const [name, sessionIds] of sessionIdsByName) {
      priorSessionCountByName.set(name, sessionIds.size);
    }
  }
  const { celebrate: celebratePrs, establishingBaseline: baselinePrs } = splitPrsByBaseline(
    prList,
    priorSessionCountByName
  );

  // Consistency streak — same broadcastLevel === "full" gate as
  // totalVolume, since this is the athlete's own activity pattern, not
  // public-by-default data. Uses the service-role client deliberately:
  // this page is genuinely public (no session to check RLS against —
  // see the file-level comment on lib/supabase/service-role.ts), and the
  // anon RLS policy on workout_logs only exposes rows tied to a public
  // post, which would silently undercount every real streak (most of an
  // athlete's history isn't individually shared). Only ever feeds a
  // small derived integer (a week count) back out, never raw rows.
  let weekStreak = 0;
  let totalWorkoutCount: number | null = null;
  if (broadcastLevel === "full") {
    const twoYearsAgo = new Date(post.created_at);
    twoYearsAgo.setFullYear(twoYearsAgo.getFullYear() - 2);
    const serviceClient = createServiceRoleClient();
    const { data: logRows } = await serviceClient
      .from("workout_logs")
      .select("created_at")
      .eq("athlete_id", post.author_id)
      .eq("group_id", post.group_id)
      .gte("created_at", twoYearsAgo.toISOString());
    const logDates = (logRows ?? []).map((r) => new Date(r.created_at));
    weekStreak = computeWeekStreak(logDates, new Date(post.created_at));

    // Only needed as substitute celebratory content when a real PR is
    // being reframed to a calm baseline message — a plain "workout
    // complete" post has no use for this number, so skip the extra
    // query in the common case.
    if (baselinePrs.length > 0) {
      const { count } = await serviceClient
        .from("workout_logs")
        .select("id", { count: "exact", head: true })
        .eq("athlete_id", post.author_id)
        .eq("group_id", post.group_id);
      totalWorkoutCount = count ?? null;
    }
  }

  // Milestone Celebrations, piece #1 (milestone_celebration_system_scoping.md)
  // — the "everything's clicking" compound card. Purely presentation over
  // three already-computed signals: this month's PR count, 7-day habit
  // compliance (same math as the client-profile page's own "Last 7 Days"
  // block, via the shared lib/habits.ts helper), and the streak already
  // computed above. Same broadcastLevel === "full" gate and service-role
  // reasoning as weekStreak — none of this is anon-visible data.
  let habitCompliancePct: number | null = null;
  let prCountThisMonth = 0;
  let compoundCelebration: string | null = null;
  if (broadcastLevel === "full") {
    const serviceClient = createServiceRoleClient();
    const asOf = new Date(post.created_at);

    const monthStart = new Date(asOf.getFullYear(), asOf.getMonth(), 1);
    // Postgres stores microsecond precision; a JS Date round-trip through
    // `asOf.toISOString()` truncates to milliseconds, which can make a
    // workout_logs row's own `created_at` compare as slightly LATER than
    // `asOf` even when `asOf` was derived from that exact same instant
    // (this genuinely happened in testing — a post and its own workout_log
    // sharing one `now()` value, off by fractional microseconds after the
    // round-trip). A 1-second buffer is comfortably larger than that
    // precision gap while still meaning "as of essentially this moment."
    const asOfBuffered = new Date(asOf.getTime() + 1000);
    const { data: monthLogRows } = await serviceClient
      .from("workout_logs")
      .select("new_prs")
      .eq("athlete_id", post.author_id)
      .eq("group_id", post.group_id)
      .gte("created_at", monthStart.toISOString())
      .lte("created_at", asOfBuffered.toISOString());
    prCountThisMonth = (monthLogRows ?? []).reduce(
      (sum, r) => sum + (r.new_prs?.length ?? 0),
      0
    );

    const sevenDaysAgo = new Date(asOf);
    sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 6);
    const windowDates = Array.from({ length: 7 }, (_, i) => {
      const d = new Date(sevenDaysAgo);
      d.setDate(d.getDate() + i);
      return d;
    });
    const { data: habitRows } = await serviceClient
      .from("client_habits")
      .select("id, weekdays")
      .eq("athlete_id", post.author_id)
      .eq("group_id", post.group_id)
      .eq("active", true);
    const activeHabits = habitRows ?? [];
    const { data: habitLogRowsRaw } = activeHabits.length > 0
      ? await serviceClient
          .from("habit_logs")
          .select("habit_id, log_date, completed_at")
          .in("habit_id", activeHabits.map((h) => h.id))
          .gte("log_date", sevenDaysAgo.toISOString().slice(0, 10))
          .lte("log_date", asOf.toISOString().slice(0, 10))
      : { data: [] as any[] };
    const habitLogRows: HabitLogRow[] = (habitLogRowsRaw ?? []).map((l: any) => ({
      habitId: l.habit_id,
      logDate: l.log_date,
      completed: !!l.completed_at,
    }));
    const { totalDue, totalCompleted } = computeHabitCompliance(
      activeHabits,
      habitLogRows,
      windowDates
    );
    habitCompliancePct = computeCompliancePct(totalCompleted, totalDue);

    const compoundInputs = { habitCompliancePct, prCountThisMonth, weekStreak };
    if (shouldShowCompoundCelebration(compoundInputs)) {
      compoundCelebration = buildCompoundCelebrationText(compoundInputs);
    }
  }

  // Milestone Celebrations, piece #2 — a lift's estimated 1RM crossing a
  // bodyweight-multiple threshold ("2x bodyweight deadlift") for the
  // first time. A threshold crossing, not a trend — reuses this
  // session's own `bestByExercise` (the exact same weight/reps pair
  // `prList`'s oneRepMax already estimates from) and each exercise's
  // prior best estimated 1RM from every OTHER completed session
  // (excluding this one, same discipline as the PR-fatigue baseline
  // check above). Gated to "full" only, not "prs_only" — body weight is
  // more sensitive than a plain PR, so this stays out of the lighter
  // broadcast tiers. Deliberately never surfaces the athlete's literal
  // bodyweight number on this public page — only the multiple and the
  // lift itself.
  const relativeStrengthMilestones: {
    exerciseName: string;
    multiple: number;
    weight: number;
    reps: number;
  }[] = [];
  if (broadcastLevel === "full" && bestByExercise.size > 0) {
    const serviceClient = createServiceRoleClient();
    const asOf = new Date(post.created_at);
    const { data: weightRow } = await serviceClient
      .from("body_weight_logs")
      .select("weight")
      .eq("athlete_id", post.author_id)
      .eq("group_id", post.group_id)
      .lte("logged_date", asOf.toISOString().slice(0, 10))
      .order("logged_date", { ascending: false })
      .limit(1)
      .maybeSingle();
    const bodyweight = weightRow?.weight ?? null;

    if (bodyweight != null) {
      const exerciseNamesThisSession = Array.from(bestByExercise.keys());
      const { data: priorSetRows } = await serviceClient
        .from("set_logs")
        .select(
          "weight, reps, status, session_exercises!inner ( session_id, exercise_name, athlete_sessions!inner ( athlete_id ) )"
        )
        .in("session_exercises.exercise_name", exerciseNamesThisSession)
        .eq("status", "completed");

      const priorBestEst1RmByName = new Map<string, number>();
      for (const row of (priorSetRows ?? []) as any[]) {
        const sessionExercise = row.session_exercises;
        if (sessionExercise.session_id === workoutLog.session_id) continue;
        if (sessionExercise.athlete_sessions?.athlete_id !== post.author_id) continue;
        if (row.weight == null || row.reps == null) continue;
        const est = estimateOneRepMax(row.weight, row.reps);
        const name = sessionExercise.exercise_name;
        const current = priorBestEst1RmByName.get(name);
        if (current == null || est > current) priorBestEst1RmByName.set(name, est);
      }

      for (const [name, best] of bestByExercise) {
        const currentEst1Rm = estimateOneRepMax(best.weight, best.reps);
        const milestone = computeRelativeStrengthMilestone(
          currentEst1Rm,
          priorBestEst1RmByName.get(name) ?? null,
          bodyweight
        );
        if (milestone) {
          relativeStrengthMilestones.push({
            exerciseName: name,
            multiple: milestone.multiple,
            weight: best.weight,
            reps: best.reps,
          });
        }
      }
    }
  }

  return {
    authorId: post.author_id as string,
    groupId: post.group_id,
    athleteName: (post.profiles as any)?.full_name ?? "An athlete",
    groupName: group?.name ?? "The Enduring Strength Collective",
    broadcastLevel,
    totalVolume: broadcastLevel === "full" ? workoutLog.total_volume ?? 0 : null,
    totalSetsCompleted: broadcastLevel === "full" ? workoutLog.total_sets_completed ?? 0 : null,
    weekStreak,
    totalWorkoutCount,
    habitCompliancePct,
    prCountThisMonth,
    compoundCelebration,
    relativeStrengthMilestones,
    topLifts,
    top5Candidates,
    selectedNames: post.shared_exercise_names ?? top5Candidates.slice(0, 3).map((l) => l.name),
    prList,
    celebratePrs,
    baselinePrs,
    createdAt: post.created_at,
  };
}

export type SharedWorkout = NonNullable<Awaited<ReturnType<typeof getSharedWorkout>>>;
