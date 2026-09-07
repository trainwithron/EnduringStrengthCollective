import { getProgressionGoal } from "@/lib/progressions";
import { DEFAULT_TRACKED_FIELDS, mapSetRow, type TrackedField } from "@/lib/exercise-fields";
import type { ExerciseSetTarget } from "@/lib/types";

export interface WorkoutOverviewExercise {
  id: string;
  exerciseOrder: number;
  movementPatternId: string | null;
  isOverridden: boolean;
  exerciseName: string;
  trackedFields: TrackedField[];
  notes: string | null;
  videoPath: string | null;
  youtubeUrl: string | null;
  sets: ExerciseSetTarget[];
}

export interface WorkoutOverviewData {
  workout: { id: string; title: string; notes: string | null; programId: string };
  exercises: WorkoutOverviewExercise[];
  dayNotes: { id: string; body: string }[];
  lastTimeByExercise: Record<string, { weight: number; reps: number }>;
  videoUrlByExerciseId: Map<string, string>;
  goalByExerciseId: Map<string, { weight: number | null; reps: number | null }>;
  existingSession: { id: string; status: string } | null;
}

// Shared by both the athlete's own workout overview page and the coach's
// "log for a client" equivalent — the two need identical resolution logic
// (overrides, video, progression goals, last-time), just aimed at whichever
// athlete is the one actually training.
export async function getWorkoutOverviewData(
  supabase: any,
  { groupId, workoutId, athleteId }: { groupId: string; workoutId: string; athleteId: string }
): Promise<WorkoutOverviewData | null> {
  const { data: workout } = await supabase
    .from("workouts")
    .select(
      `
      id, title, notes, program_id,
      group_workout_exercises (
        id, exercise_name, exercise_order, movement_pattern_id, tracked_fields, notes,
        group_workout_exercise_sets ( id, set_order, target_reps, target_weight, target_rpe, target_rir, target_tempo, target_time_seconds, target_height, target_distance )
      ),
      workout_notes ( id, body, position )
    `
    )
    .eq("id", workoutId)
    .eq("group_id", groupId)
    .single();

  if (!workout) return null;

  const { data: existingSessionRow } = await supabase
    .from("athlete_sessions")
    .select("id, status")
    .eq("workout_id", workoutId)
    .eq("athlete_id", athleteId)
    .maybeSingle();

  const templateExercises = (workout.group_workout_exercises ?? [])
    .slice()
    .sort((a: any, b: any) => a.exercise_order - b.exercise_order);

  // Per-client overrides are a name-swap only — same set/rep scheme as the
  // template, different exercise (e.g. a ladder regression for one client).
  const slotIds = templateExercises.map((ex: any) => ex.id);
  const overrideNameBySlot = new Map<string, string>();

  if (slotIds.length > 0) {
    const { data: overrides } = await supabase
      .from("athlete_exercise_overrides")
      .select("group_workout_exercise_id, exercise_name")
      .eq("athlete_id", athleteId)
      .in("group_workout_exercise_id", slotIds);

    for (const o of overrides ?? []) {
      overrideNameBySlot.set(o.group_workout_exercise_id, o.exercise_name);
    }
  }

  // Exercise video/YouTube is attached on the coach's shared exercise
  // library, keyed by name.
  const { data: coachMembership } = await supabase
    .from("group_memberships")
    .select("profile_id")
    .eq("group_id", groupId)
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

  const exercises: WorkoutOverviewExercise[] = templateExercises.map((ex: any) => {
    const resolvedName = overrideNameBySlot.get(ex.id) ?? ex.exercise_name;
    const media = mediaByName.get(resolvedName);
    return {
      id: ex.id,
      exerciseOrder: ex.exercise_order,
      movementPatternId: ex.movement_pattern_id,
      isOverridden: overrideNameBySlot.has(ex.id),
      exerciseName: resolvedName,
      trackedFields: (ex.tracked_fields ?? DEFAULT_TRACKED_FIELDS) as TrackedField[],
      notes: ex.notes as string | null,
      videoPath: media?.videoPath ?? null,
      youtubeUrl: media?.youtubeUrl ?? null,
      sets: (ex.group_workout_exercise_sets ?? [])
        .slice()
        .sort((a: any, b: any) => a.set_order - b.set_order)
        .map(mapSetRow),
    };
  });

  // "Last time" — most recent completed set per exercise name, from any
  // other completed session this athlete has logged.
  const exerciseNames = exercises.map((ex) => ex.exerciseName);
  const lastTimeByExercise: Record<string, { weight: number; reps: number }> = {};

  if (exerciseNames.length > 0) {
    const { data: priorSets } = await supabase
      .from("set_logs")
      .select(
        `
        weight, reps, completed_at,
        session_exercises!inner (
          exercise_name,
          athlete_sessions!inner ( athlete_id )
        )
      `
      )
      .in("session_exercises.exercise_name", exerciseNames)
      .eq("session_exercises.athlete_sessions.athlete_id", athleteId)
      .eq("status", "completed")
      .order("completed_at", { ascending: false });

    for (const row of (priorSets ?? []) as any[]) {
      const name = row.session_exercises.exercise_name;
      if (!(name in lastTimeByExercise) && row.weight != null && row.reps != null) {
        lastTimeByExercise[name] = { weight: row.weight, reps: row.reps };
      }
    }
  }

  const videoUrlByExerciseId = new Map<string, string>();
  await Promise.all(
    exercises.map(async (ex) => {
      if (!ex.videoPath) return;
      const { data } = await supabase.storage
        .from("exercise-media")
        .createSignedUrl(ex.videoPath, 3600);
      if (data?.signedUrl) videoUrlByExerciseId.set(ex.id, data.signedUrl);
    })
  );

  // Progression goals only matter for starting a fresh session — an
  // existing session already has its own set_logs.
  const goalByExerciseId = new Map<string, { weight: number | null; reps: number | null }>();
  if (!existingSessionRow) {
    await Promise.all(
      exercises.map(async (ex) => {
        const goal = await getProgressionGoal(supabase, {
          programId: workout.program_id,
          exerciseName: ex.exerciseName,
          athleteId,
          currentWorkoutId: workoutId,
        });
        if (goal && (goal.weight != null || goal.reps != null)) {
          goalByExerciseId.set(ex.id, goal);
        }
      })
    );
  }

  const dayNotes = (workout.workout_notes ?? [])
    .slice()
    .sort((a: any, b: any) => a.position - b.position)
    .map((n: any) => ({ id: n.id, body: n.body }));

  return {
    workout: {
      id: workout.id,
      title: workout.title,
      notes: workout.notes,
      programId: workout.program_id,
    },
    exercises,
    dayNotes,
    lastTimeByExercise,
    videoUrlByExerciseId,
    goalByExerciseId,
    existingSession: existingSessionRow,
  };
}
