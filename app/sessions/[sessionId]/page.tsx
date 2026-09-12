import { redirect } from "next/navigation";
import Link from "next/link";
import { createServerClient } from "@/lib/supabase/server";
import { SessionLogger } from "@/components/logging/session-logger";
import { DEFAULT_TRACKED_FIELDS } from "@/lib/exercise-fields";
import { CoachLoggedBadge } from "@/components/coach-logged-badge";
import { BottomTabBar } from "@/components/athlete/bottom-tab-bar";
import type { SessionExerciseEntry } from "@/lib/types";
import { findCorrelatingWeightSuggestion, resolveWeightSuggestion } from "@/lib/set-suggestions";
import { parseNumericReps } from "@/lib/program-card-visuals";
import { computePriorBest } from "@/lib/obstacle-unlock";

export default async function SessionPage(
  props: {
    params: Promise<{ sessionId: string }>;
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

  const { data: session } = await supabase
    .from("athlete_sessions")
    .select("id, status, athlete_id, group_id, logged_by_coach, workout_id, started_at, workouts ( title )")
    .eq("id", params.sessionId)
    .single();

  if (!session) {
    return (
      <main className="min-h-screen bg-graphite text-chalk flex items-center justify-center px-6">
        <p className="font-body text-steel text-center">
          This session isn&apos;t available, or you don&apos;t have access to it.
        </p>
      </main>
    );
  }

  const { data: sessionExercises } = await supabase
    .from("session_exercises")
    .select(
      `
      id, exercise_name, exercise_order, is_swapped, is_added, movement_pattern_id, tracked_fields, group_workout_exercise_id,
      group_workout_exercises ( notes ),
      set_logs ( id, set_order, weight, reps, rpe, rir, tempo, time_seconds, height, distance, rest_seconds, pace, status, weight_confirmed )
    `
    )
    .eq("session_id", params.sessionId)
    .order("exercise_order", { ascending: true });

  // Prescribed values for the "extra" fields (RPE, RIR, tempo, etc.) —
  // shown as a placeholder hint during logging, never pre-committed into
  // set_logs itself (see start-workout-button.tsx). Keyed by
  // (group_workout_exercise_id, set_order) since that's the only stable
  // link back to the template once a session has its own copy of the sets.
  const templateExerciseIds = (sessionExercises ?? [])
    .map((se: any) => se.group_workout_exercise_id)
    .filter((id: string | null): id is string => id != null);

  const targetsByExerciseAndOrder = new Map<
    string,
    {
      rpe: number | null;
      rir: number | null;
      tempo: string | null;
      timeSeconds: number | null;
      height: number | null;
      distance: number | null;
      restSeconds: number | null;
      pace: string | null;
      reps: number | null;
      weight: number | null;
    }
  >();
  if (templateExerciseIds.length > 0) {
    const { data: templateSets } = await supabase
      .from("group_workout_exercise_sets")
      .select(
        "group_workout_exercise_id, set_order, target_rpe, target_rir, target_tempo, target_time_seconds, target_height, target_distance, target_rest_seconds, target_pace, target_reps, target_weight"
      )
      .in("group_workout_exercise_id", templateExerciseIds);
    for (const t of templateSets ?? []) {
      targetsByExerciseAndOrder.set(`${t.group_workout_exercise_id}:${t.set_order}`, {
        rpe: t.target_rpe,
        rir: t.target_rir,
        tempo: t.target_tempo,
        timeSeconds: t.target_time_seconds,
        height: t.target_height,
        distance: t.target_distance,
        restSeconds: t.target_rest_seconds,
        pace: t.target_pace,
        reps: parseNumericReps(t.target_reps),
        weight: t.target_weight,
      });
    }
  }

  // Correlating-week weight suggestion (lib/set-suggestions.ts) — real
  // logged history for this athlete on these exercises, joined back to
  // each historical set's OWN target reps/RPE/RIR the same way the
  // workout-overview page does it. A grayed-out hint only; never
  // committed into set_logs the way a coach-set target_weight already is.
  const exerciseNamesInSession = Array.from(
    new Set((sessionExercises ?? []).map((se: any) => se.exercise_name as string))
  );
  const { data: priorRows } = exerciseNamesInSession.length > 0
    ? await supabase
        .from("set_logs")
        .select(
          `
          weight, reps, rpe, rir, set_order, completed_at,
          session_exercises!inner (
            exercise_name, group_workout_exercise_id, session_id,
            athlete_sessions!inner ( athlete_id )
          )
        `
        )
        .in("session_exercises.exercise_name", exerciseNamesInSession)
        .eq("session_exercises.athlete_sessions.athlete_id", session.athlete_id)
        .eq("status", "completed")
    : { data: [] as any[] };

  // Obstacle-unlock mechanic (lib/obstacle-unlock.ts) — this athlete's
  // real all-time best (weight/reps/single-set volume) per exercise name,
  // from the exact same historical rows already fetched just above for
  // the weight-suggestion feature (no new query) — but excluding THIS
  // session specifically, unlike that feature's own history. A "genuine
  // PR" can't be measured against a set logged moments ago in the same
  // session; the weight-suggestion feature's own history query is left
  // untouched since it's a separate, already-shipped behavior.
  const priorBestByExerciseName = new Map<
    string,
    { maxWeight: number | null; maxReps: number | null; maxVolume: number | null }
  >();
  {
    const rowsByName = new Map<string, { weight: number | null; reps: number | null }[]>();
    for (const row of (priorRows ?? []) as any[]) {
      if (row.session_exercises.session_id === params.sessionId) continue;
      const name = row.session_exercises.exercise_name as string;
      const list = rowsByName.get(name) ?? [];
      list.push({ weight: row.weight, reps: row.reps });
      rowsByName.set(name, list);
    }
    for (const [name, rows] of rowsByName) {
      priorBestByExerciseName.set(name, computePriorBest(rows));
    }
  }

  const priorTemplateIds = Array.from(
    new Set(
      (priorRows ?? [])
        .map((r: any) => r.session_exercises.group_workout_exercise_id as string | null)
        .filter((id: string | null): id is string => !!id)
    )
  );
  const { data: priorTargetRows } = priorTemplateIds.length > 0
    ? await supabase
        .from("group_workout_exercise_sets")
        .select("group_workout_exercise_id, set_order, target_reps, target_rpe, target_rir")
        .in("group_workout_exercise_id", priorTemplateIds)
    : { data: [] as any[] };

  const priorTargetByExerciseAndOrder = new Map<
    string,
    { targetReps: number | null; targetRpe: number | null; targetRir: number | null }
  >();
  for (const row of priorTargetRows ?? []) {
    priorTargetByExerciseAndOrder.set(`${row.group_workout_exercise_id}::${row.set_order}`, {
      targetReps: parseNumericReps(row.target_reps),
      targetRpe: row.target_rpe,
      targetRir: row.target_rir,
    });
  }

  const historyByExerciseName = new Map<
    string,
    { loggedAt: string; weight: number | null; targetReps: number | null; targetRpe: number | null; targetRir: number | null }[]
  >();
  for (const row of (priorRows ?? []) as any[]) {
    const name = row.session_exercises.exercise_name as string;
    const templateId = row.session_exercises.group_workout_exercise_id as string | null;
    const targets = templateId
      ? priorTargetByExerciseAndOrder.get(`${templateId}::${row.set_order}`)
      : undefined;
    const list = historyByExerciseName.get(name) ?? [];
    list.push({
      loggedAt: row.completed_at,
      weight: row.weight,
      targetReps: targets?.targetReps ?? null,
      targetRpe: targets?.targetRpe ?? row.rpe ?? null,
      targetRir: targets?.targetRir ?? row.rir ?? null,
    });
    historyByExerciseName.set(name, list);
  }

  // Exercise video/YouTube is attached on the coach's shared exercise
  // library, keyed by name — same lookup as the workout overview page.
  const { data: coachMembership } = await supabase
    .from("group_memberships")
    .select("profile_id")
    .eq("group_id", session.group_id)
    .eq("role", "coach")
    .limit(1)
    .maybeSingle();

  // Per-group on/off preference for the gamified-logging thread (Phase 1:
  // the obstacle-unlock mechanic) — same reasoning as optional RPE/RIR.
  const { data: groupRow } = await supabase
    .from("groups")
    .select("gamification_enabled")
    .eq("id", session.group_id)
    .maybeSingle();
  const gamificationEnabled = groupRow?.gamification_enabled ?? true;

  const mediaByName = new Map<
    string,
    { videoPath: string | null; youtubeUrl: string | null; equipmentType: string | null }
  >();
  if (coachMembership) {
    const { data: libraryRows } = await supabase
      .from("exercise_library")
      .select("name, video_path, youtube_url, equipment_type")
      .eq("created_by", coachMembership.profile_id);
    for (const row of libraryRows ?? []) {
      mediaByName.set(row.name, {
        videoPath: row.video_path,
        youtubeUrl: row.youtube_url,
        equipmentType: row.equipment_type,
      });
    }
  }

  const exercises: SessionExerciseEntry[] = await Promise.all(
    (sessionExercises ?? []).map(async (se: any) => {
      const media = mediaByName.get(se.exercise_name);
      let videoUrl: string | null = null;
      if (media?.videoPath) {
        const { data } = await supabase.storage
          .from("exercise-media")
          .createSignedUrl(media.videoPath, 3600);
        videoUrl = data?.signedUrl ?? null;
      }

      return {
        id: se.id,
        exerciseName: se.exercise_name,
        exerciseOrder: se.exercise_order,
        isSwapped: se.is_swapped,
        isAdded: se.is_added,
        trackedFields: se.tracked_fields ?? DEFAULT_TRACKED_FIELDS,
        videoUrl,
        youtubeUrl: media?.youtubeUrl ?? null,
        equipmentType: (media?.equipmentType as SessionExerciseEntry["equipmentType"]) ?? null,
        notes: se.group_workout_exercises?.notes ?? null,
        priorBest: priorBestByExerciseName.get(se.exercise_name) ?? {
          maxWeight: null,
          maxReps: null,
          maxVolume: null,
        },
        sets: (se.set_logs ?? [])
          .slice()
          .sort((a: any, b: any) => a.set_order - b.set_order)
          .map((sl: any) => {
            const target = se.group_workout_exercise_id
              ? targetsByExerciseAndOrder.get(`${se.group_workout_exercise_id}:${sl.set_order}`)
              : undefined;
            return {
              id: sl.id,
              setOrder: sl.set_order,
              weight: sl.weight,
              reps: sl.reps,
              rpe: sl.rpe,
              rir: sl.rir,
              tempo: sl.tempo,
              timeSeconds: sl.time_seconds,
              height: sl.height,
              distance: sl.distance,
              restSeconds: sl.rest_seconds,
              pace: sl.pace,
              status: sl.status,
              weightConfirmed: !!sl.weight_confirmed,
              targetReps: target?.reps ?? null,
              targetWeight: target?.weight ?? null,
              targetRpe: target?.rpe ?? null,
              targetRir: target?.rir ?? null,
              targetTempo: target?.tempo ?? null,
              targetTimeSeconds: target?.timeSeconds ?? null,
              targetHeight: target?.height ?? null,
              targetDistance: target?.distance ?? null,
              targetRestSeconds: target?.restSeconds ?? null,
              targetPace: target?.pace ?? null,
              suggestedWeight:
                sl.weight == null
                  ? resolveWeightSuggestion(
                      findCorrelatingWeightSuggestion(
                        historyByExerciseName.get(se.exercise_name) ?? [],
                        target?.reps ?? null,
                        target?.rpe ?? null,
                        target?.rir ?? null
                      ),
                      target?.weight ?? null
                    )
                  : null,
            };
          }),
      };
    })
  );

  // "Last time" lookup: most recent completed set per exercise name, from any
  // other completed session belonging to this athlete.
  const exerciseNames = exercises.map((ex) => ex.exerciseName);
  const lastTimeByExercise: Record<string, { weight: number; reps: number }> = {};

  if (exerciseNames.length > 0) {
    const { data: priorSets } = await supabase
      .from("set_logs")
      .select(
        `
        weight, reps, completed_at,
        session_exercises!inner (
          exercise_name, session_id,
          athlete_sessions!inner ( athlete_id )
        )
      `
      )
      .in("session_exercises.exercise_name", exerciseNames)
      .eq("session_exercises.athlete_sessions.athlete_id", session.athlete_id)
      .neq("session_exercises.session_id", params.sessionId)
      .eq("status", "completed")
      .order("completed_at", { ascending: false });

    for (const row of (priorSets ?? []) as any[]) {
      const name = row.session_exercises.exercise_name;
      if (!(name in lastTimeByExercise) && row.weight != null && row.reps != null) {
        lastTimeByExercise[name] = { weight: row.weight, reps: row.reps };
      }
    }
  }

  // Client-facing swap alternatives: for any exercise tagged with a
  // movement pattern, offer its ladder as quick-pick options — so an
  // athlete can self-substitute (machine taken, coach adjusting on the fly)
  // without needing the coach to intervene.
  const ladderByExercise: Record<string, string[]> = {};
  const patternIds = Array.from(
    new Set((sessionExercises ?? []).map((se: any) => se.movement_pattern_id).filter(Boolean))
  );

  if (patternIds.length > 0) {
    const { data: ladderRows } = await supabase
      .from("movement_pattern_exercises")
      .select("movement_pattern_id, exercise_name, difficulty_rank")
      .in("movement_pattern_id", patternIds)
      .order("difficulty_rank", { ascending: true });

    const ladderByPattern = new Map<string, string[]>();
    for (const row of ladderRows ?? []) {
      const list = ladderByPattern.get(row.movement_pattern_id) ?? [];
      list.push(row.exercise_name);
      ladderByPattern.set(row.movement_pattern_id, list);
    }

    for (const se of (sessionExercises ?? []) as any[]) {
      if (se.movement_pattern_id) {
        const ladder = ladderByPattern.get(se.movement_pattern_id);
        if (ladder) ladderByExercise[se.exercise_name] = ladder;
      }
    }
  }

  const isOwnSession = session.athlete_id === user.id;

  // Video upload/feedback is visible to the session's own athlete and to
  // the group's coach (e.g. logging or reviewing in person) — not a
  // random third party who happens to reach this URL; RLS enforces the
  // real boundary regardless, this just decides what the UI offers.
  const { data: viewerMembership } = await supabase
    .from("group_memberships")
    .select("role")
    .eq("group_id", session.group_id)
    .eq("profile_id", user.id)
    .maybeSingle();
  const viewerIsCoach = viewerMembership?.role === "coach";
  const canUploadVideo = isOwnSession || viewerIsCoach;

  // A completed session that generated a shareable card can always be
  // revisited — not just right after finishing — so the athlete can grab
  // the link again later instead of it only being reachable the one time
  // it flashed by right after completion.
  let sharePostId: string | null = null;
  if (session.status === "completed") {
    const { data: workoutLog } = await supabase
      .from("workout_logs")
      .select("id, posts ( id )")
      .eq("session_id", params.sessionId)
      .maybeSingle();
    sharePostId = (workoutLog?.posts as any)?.id ?? null;
  }

  const backHref = session.workout_id
    ? `/groups/${session.group_id}/workouts/${session.workout_id}`
    : `/groups/${session.group_id}`;

  return (
    <main className="min-h-screen bg-graphite text-chalk font-body pb-32">
      <header className="px-5 pt-8 pb-6 border-b border-steel/20">
        <Link href={backHref} className="font-body text-xs text-steel uppercase tracking-wide">
          &larr; Back
        </Link>
        <div className="flex items-center justify-between mt-3">
          <p className="font-body text-xs text-steel uppercase tracking-wide">
            {session.status === "completed" ? "Completed" : "In progress"}
          </p>
          {session.logged_by_coach && <CoachLoggedBadge />}
        </div>
        <h1 className="font-display font-bold text-3xl leading-none mt-1 uppercase">
          {(session as any).workouts?.title ?? "Workout"}
        </h1>
        {sharePostId && (
          <Link
            href={`/share/${sharePostId}`}
            className="inline-block mt-3 font-body text-xs text-rust"
          >
            View share card &rarr;
          </Link>
        )}
      </header>

      <SessionLogger
        sessionId={session.id}
        isCompleted={session.status === "completed"}
        initialExercises={exercises}
        lastTimeByExercise={lastTimeByExercise}
        ladderByExercise={ladderByExercise}
        raised={isOwnSession}
        groupId={session.group_id}
        athleteId={session.athlete_id}
        viewerId={user.id}
        canUploadVideo={canUploadVideo}
        startedAt={session.started_at}
        gamificationEnabled={gamificationEnabled}
      />

      {isOwnSession && (
        <BottomTabBar groupId={session.group_id} activeOverride="workout" />
      )}
    </main>
  );
}
