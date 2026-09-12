import { createServerClient } from "@/lib/supabase/server";
import { createServiceRoleClient } from "@/lib/supabase/service-role";
import { estimateOneRepMax } from "@/lib/one-rep-max";
import { computeWeekStreak } from "@/lib/consistency-streak";
import { splitPrsByBaseline } from "@/lib/pr-fatigue";

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
