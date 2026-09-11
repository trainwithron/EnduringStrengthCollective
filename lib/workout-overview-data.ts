import { getProgressionGoalsBatch } from "@/lib/progressions";
import { DEFAULT_TRACKED_FIELDS, mapSetRow, type TrackedField } from "@/lib/exercise-fields";
import { findCorrelatingWeightSuggestion, resolveWeightSuggestion } from "@/lib/set-suggestions";
import { parseNumericReps } from "@/lib/program-card-visuals";
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
  // The coach's own approved alternatives for this exercise's movement
  // pattern (excluding itself) — the only options a pre-start swap is
  // allowed to offer, so the athlete stays on-program instead of picking
  // anything at all.
  ladder: string[];
}

export interface WorkoutOverviewData {
  workout: { id: string; title: string; notes: string | null; programId: string };
  exercises: WorkoutOverviewExercise[];
  dayNotes: { id: string; body: string }[];
  lastTimeByExercise: Record<string, { weight: number; reps: number }>;
  videoUrlByExerciseId: Map<string, string>;
  goalByExerciseId: Map<string, { weight: number | null; reps: number | null }>;
  // Correlating-week weight suggestion, keyed by this set's own template
  // id — a grayed-out placeholder shown in the logging UI, never
  // auto-committed as a real value (see lib/set-suggestions.ts).
  suggestedWeightBySetId: Map<string, number | null>;
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

  // The coach's approved ladder of alternatives per movement pattern —
  // same source the mid-session swap already uses, just resolved here so
  // a pre-start swap can offer the identical "only approved exercises"
  // set before the athlete ever begins.
  const patternIds = Array.from(
    new Set(templateExercises.map((ex: any) => ex.movement_pattern_id).filter(Boolean))
  );
  const ladderByPattern = new Map<string, string[]>();
  if (patternIds.length > 0) {
    const { data: ladderRows } = await supabase
      .from("movement_pattern_exercises")
      .select("movement_pattern_id, exercise_name, difficulty_rank")
      .in("movement_pattern_id", patternIds)
      .order("difficulty_rank", { ascending: true });
    for (const row of ladderRows ?? []) {
      const list = ladderByPattern.get(row.movement_pattern_id) ?? [];
      list.push(row.exercise_name);
      ladderByPattern.set(row.movement_pattern_id, list);
    }
  }

  const exercises: WorkoutOverviewExercise[] = templateExercises.map((ex: any) => {
    const resolvedName = overrideNameBySlot.get(ex.id) ?? ex.exercise_name;
    const media = mediaByName.get(resolvedName);
    const fullLadder = ex.movement_pattern_id ? ladderByPattern.get(ex.movement_pattern_id) ?? [] : [];
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
      ladder: fullLadder.filter((name) => name !== resolvedName),
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
        weight, reps, rpe, rir, set_order, completed_at,
        session_exercises!inner (
          exercise_name, group_workout_exercise_id,
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

  // Correlating-week weight suggestion — for each historical logged set,
  // recover what its OWN target reps/RPE/RIR actually were (not the
  // current workout's), by looking up the template row it was logged
  // against. Batched: one extra query for every distinct
  // (group_workout_exercise_id) seen in history, not one per row.
  const priorRows = (priorSetsResult.data ?? []) as any[];
  const templateExerciseIds = Array.from(
    new Set(
      priorRows
        .map((r) => r.session_exercises.group_workout_exercise_id as string | null)
        .filter((id): id is string => !!id)
    )
  );
  const { data: historicalTargetRows } = templateExerciseIds.length > 0
    ? await supabase
        .from("group_workout_exercise_sets")
        .select("group_workout_exercise_id, set_order, target_reps, target_rpe, target_rir")
        .in("group_workout_exercise_id", templateExerciseIds)
    : { data: [] as any[] };

  const targetByExerciseAndOrder = new Map<
    string,
    { targetReps: number | null; targetRpe: number | null; targetRir: number | null }
  >();
  for (const row of (historicalTargetRows ?? []) as any[]) {
    targetByExerciseAndOrder.set(`${row.group_workout_exercise_id}::${row.set_order}`, {
      targetReps: parseNumericReps(row.target_reps),
      targetRpe: row.target_rpe,
      targetRir: row.target_rir,
    });
  }

  const historyByExerciseName = new Map<
    string,
    { loggedAt: string; weight: number | null; targetReps: number | null; targetRpe: number | null; targetRir: number | null }[]
  >();
  for (const row of priorRows) {
    const name = row.session_exercises.exercise_name as string;
    const templateId = row.session_exercises.group_workout_exercise_id as string | null;
    const targets = templateId
      ? targetByExerciseAndOrder.get(`${templateId}::${row.set_order}`)
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

  const suggestedWeightBySetId = new Map<string, number | null>();
  for (const ex of exercises) {
    const history = historyByExerciseName.get(ex.exerciseName) ?? [];
    for (const set of ex.sets) {
      const currentTargetReps = parseNumericReps(set.targetReps);
      const correlatingMatch = findCorrelatingWeightSuggestion(
        history,
        currentTargetReps,
        set.targetRpe,
        set.targetRir
      );
      const suggestion = resolveWeightSuggestion(correlatingMatch, set.targetWeight);
      if (suggestion != null) suggestedWeightBySetId.set(set.id, suggestion);
    }
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
    suggestedWeightBySetId,
    existingSession: existingSessionRow,
  };
}
