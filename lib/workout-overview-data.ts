import { getProgressionGoalsBatch } from "@/lib/progressions";
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
  // The workout template, this athlete's existing session (if any), and the
  // group's coach are all independent lookups — none needs another's
  // result — so they fire as one round trip instead of three sequential
  // ones. This is the athlete's most-visited page; every query removed
  // from the critical path here is felt on every workout open.
  const [{ data: workout }, { data: existingSessionRow }, { data: coachMembership }] =
    await Promise.all([
      supabase
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
        .single(),
      supabase
        .from("athlete_sessions")
        .select("id, status")
        .eq("workout_id", workoutId)
        .eq("athlete_id", athleteId)
        .maybeSingle(),
      supabase
        .from("group_memberships")
        .select("profile_id")
        .eq("group_id", groupId)
        .eq("role", "coach")
        .limit(1)
        .maybeSingle(),
    ]);

  if (!workout) return null;

  const templateExercises = (workout.group_workout_exercises ?? [])
    .slice()
    .sort((a: any, b: any) => a.exercise_order - b.exercise_order);

  // Per-client overrides (keyed by this workout's slot ids) and the coach's
  // exercise-media library (keyed by coach id) are independent of each
  // other — both fire together instead of one after the other.
  const slotIds = templateExercises.map((ex: any) => ex.id);

  const [overridesResult, libraryResult] = await Promise.all([
    slotIds.length > 0
      ? supabase
          .from("athlete_exercise_overrides")
          .select("group_workout_exercise_id, exercise_name")
          .eq("athlete_id", athleteId)
          .in("group_workout_exercise_id", slotIds)
      : Promise.resolve({ data: [] }),
    coachMembership
      ? supabase
          .from("exercise_library")
          .select("name, video_path, youtube_url")
          .eq("created_by", coachMembership.profile_id)
      : Promise.resolve({ data: [] }),
  ]);

  // Per-client overrides are a name-swap only — same set/rep scheme as the
  // template, different exercise (e.g. a ladder regression for one client).
  const overrideNameBySlot = new Map<string, string>();
  for (const o of overridesResult.data ?? []) {
    overrideNameBySlot.set(o.group_workout_exercise_id, o.exercise_name);
  }

  // Exercise video/YouTube is attached on the coach's shared exercise
  // library, keyed by name.
  const mediaByName = new Map<string, { videoPath: string | null; youtubeUrl: string | null }>();
  for (const row of libraryResult.data ?? []) {
    mediaByName.set(row.name, { videoPath: row.video_path, youtubeUrl: row.youtube_url });
  }

  // Progression rules are keyed by the coach's original template exercise
  // name (exercise_progressions.exercise_name), never by a per-client
  // override — an override only swaps what's *displayed and logged* for
  // one athlete, it doesn't move the exercise to a different progression
  // rule. Keep the template name around per slot so the goal lookup below
  // uses it instead of the resolved/overridden name.
  const templateNameById = new Map<string, string>(
    templateExercises.map((ex: any) => [ex.id, ex.exercise_name])
  );

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

  // "Last time" (prior sets), exercise-video signed URLs, and progression
  // goals are all independent of each other — each only needs `exercises`,
  // already resolved above — so all three fire together instead of as
  // three sequential phases.
  const exerciseNames = exercises.map((ex) => ex.exerciseName);
  const videoUrlByExerciseId = new Map<string, string>();

  const [priorSetsResult, , goalsBatch] = await Promise.all([
    exerciseNames.length > 0
      ? supabase
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
          .order("completed_at", { ascending: false })
      : Promise.resolve({ data: [] }),

    // Video signed URLs mutate videoUrlByExerciseId directly rather than
    // returning a value — the destructured hole above just lets this run
    // concurrently with the other two without awaiting it separately.
    (async () => {
      await Promise.all(
        exercises.map(async (ex) => {
          if (!ex.videoPath) return;
          const { data } = await supabase.storage
            .from("exercise-media")
            .createSignedUrl(ex.videoPath, 3600);
          if (data?.signedUrl) videoUrlByExerciseId.set(ex.id, data.signedUrl);
        })
      );
    })(),

    // Progression goals only matter for starting a fresh session — an
    // existing session already has its own set_logs.
    existingSessionRow
      ? Promise.resolve(new Map<string, { weight: number | null; reps: number | null }>())
      : getProgressionGoalsBatch(supabase, {
          programId: workout.program_id,
          athleteId,
          currentWorkoutId: workoutId,
          exercises: exercises.map((ex) => ({
            slotId: ex.id,
            exerciseName: templateNameById.get(ex.id) ?? ex.exerciseName,
            loggedExerciseName: ex.exerciseName,
          })),
        }),
  ]);

  const lastTimeByExercise: Record<string, { weight: number; reps: number }> = {};
  for (const row of (priorSetsResult.data ?? []) as any[]) {
    const name = row.session_exercises.exercise_name;
    if (!(name in lastTimeByExercise) && row.weight != null && row.reps != null) {
      lastTimeByExercise[name] = { weight: row.weight, reps: row.reps };
    }
  }

  const goalByExerciseId = goalsBatch;

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
