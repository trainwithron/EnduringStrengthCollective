import { redirect } from "next/navigation";
import { createServerClient } from "@/lib/supabase/server";
import { SessionLogger } from "@/components/logging/session-logger";
import { DEFAULT_TRACKED_FIELDS } from "@/lib/exercise-fields";
import { CoachLoggedBadge } from "@/components/coach-logged-badge";
import { BottomTabBar } from "@/components/athlete/bottom-tab-bar";
import type { SessionExerciseEntry } from "@/lib/types";

export default async function SessionPage({
  params,
}: {
  params: { sessionId: string };
}) {
  const supabase = createServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect("/login");
  }

  const { data: session } = await supabase
    .from("athlete_sessions")
    .select("id, status, athlete_id, group_id, logged_by_coach, workouts ( title )")
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
      id, exercise_name, exercise_order, is_swapped, is_added, movement_pattern_id, tracked_fields,
      group_workout_exercises ( notes ),
      set_logs ( id, set_order, weight, reps, rpe, rir, tempo, time_seconds, height, distance, status )
    `
    )
    .eq("session_id", params.sessionId)
    .order("exercise_order", { ascending: true });

  // Exercise video/YouTube is attached on the coach's shared exercise
  // library, keyed by name — same lookup as the workout overview page.
  const { data: coachMembership } = await supabase
    .from("group_memberships")
    .select("profile_id")
    .eq("group_id", session.group_id)
    .eq("role", "coach")
    .limit(1)
    .maybeSingle();

  const mediaByName = new Map<string, { videoPath: string | null; youtubeUrl: string | null }>();
  if (coachMembership) {
    const { data: libraryRows } = await supabase
      .from("exercise_library")
      .select("name, video_path, youtube_url")
      .eq("created_by", coachMembership.profile_id);
    for (const row of libraryRows ?? []) {
      mediaByName.set(row.name, { videoPath: row.video_path, youtubeUrl: row.youtube_url });
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
        notes: se.group_workout_exercises?.notes ?? null,
        sets: (se.set_logs ?? [])
          .slice()
          .sort((a: any, b: any) => a.set_order - b.set_order)
          .map((sl: any) => ({
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
            status: sl.status,
          })),
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

  return (
    <main className="min-h-screen bg-graphite text-chalk font-body pb-32">
      <header className="px-5 pt-8 pb-6 border-b border-steel/20">
        <div className="flex items-center justify-between">
          <p className="font-body text-xs text-steel uppercase tracking-wide">
            {session.status === "completed" ? "Completed" : "In progress"}
          </p>
          {session.logged_by_coach && <CoachLoggedBadge />}
        </div>
        <h1 className="font-display font-bold text-3xl leading-none mt-1 uppercase">
          {(session as any).workouts?.title ?? "Workout"}
        </h1>
      </header>

      <SessionLogger
        sessionId={session.id}
        isCompleted={session.status === "completed"}
        initialExercises={exercises}
        lastTimeByExercise={lastTimeByExercise}
        ladderByExercise={ladderByExercise}
        raised={isOwnSession}
      />

      {isOwnSession && (
        <BottomTabBar groupId={session.group_id} activeOverride="workout" />
      )}
    </main>
  );
}
