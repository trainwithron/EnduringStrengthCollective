import { ACTUAL_PROP, orderTrackedFields, type TrackedField } from "@/lib/exercise-fields";

export interface RecapSetEntry {
  setOrder: number;
  reps: number | null;
  weight: number | null;
  rpe: number | null;
  rir: number | null;
  tempo: string | null;
  timeSeconds: number | null;
  height: number | null;
  distance: number | null;
  restSeconds: number | null;
  pace: string | null;
}

export interface RecapExercise {
  sessionExerciseId: string;
  exerciseName: string;
  trackedFields: TrackedField[];
  sets: RecapSetEntry[];
  isPr: boolean;
  coachNote: string;
  // The swipe-card carousel's "coach note first" callout only ever shows
  // a note the coach explicitly opted into sharing (mobile_home_workout_
  // tab_merge_idea.md) — this recap page is where that opt-in lives.
  visibleToAthlete: boolean;
  // training_max_pr_card_visibility_idea.md — the persisted, RPE-aware
  // training-max estimate (athlete_training_maxes, migration 0155) was
  // already auto-updating on every set logged, just invisible. True only
  // when one of THIS session's own sets is the exact set that set the
  // athlete's current stored estimate for this exercise (matched on
  // weight+reps, not just "a PR happened around the same time") — a real
  // correlation, not an assumption the two always coincide.
  trainingMaxBumped: boolean;
  trainingMaxEstimate: number | null;
  trainingMaxAssumedEffort: boolean;
}

export interface SessionRecap {
  sessionId: string;
  groupId: string;
  athleteId: string;
  athleteName: string;
  workoutTitle: string;
  showTrainingMaxOnPr: boolean;
  workoutId: string | null;
  completedAt: string | null;
  durationSeconds: number | null;
  totalVolume: number;
  totalSetsCompleted: number;
  prCount: number;
  exercises: RecapExercise[];
  sessionNote: string;
}

// Assembles today's completed-session recap card — reuses the exact
// fields the post-workout share card and client-profile history already
// read (total_volume/total_sets_completed/new_prs on workout_logs), plus
// the real per-set breakdown and the two new coach-only note tables.
export async function getSessionRecap(
  supabase: any,
  sessionId: string,
  viewingCoachId: string
): Promise<SessionRecap | null> {
  const [{ data: session }, { data: workoutLog }, { data: sessionNoteRow }, { data: coachPrefRow }] = await Promise.all([
    supabase
      .from("athlete_sessions")
      .select(
        "id, group_id, athlete_id, workout_id, completed_at, duration_seconds, workouts ( title ), profiles!athlete_sessions_athlete_id_fkey ( full_name )"
      )
      .eq("id", sessionId)
      .maybeSingle(),
    supabase
      .from("workout_logs")
      .select("total_volume, total_sets_completed, new_prs")
      .eq("session_id", sessionId)
      .maybeSingle(),
    supabase.from("session_coach_notes").select("body").eq("session_id", sessionId).maybeSingle(),
    supabase
      .from("coach_preferences")
      .select("show_training_max_on_pr")
      .eq("coach_id", viewingCoachId)
      .maybeSingle(),
  ]);

  if (!session) return null;

  // Defaults true (matches the column's own db default) whenever this
  // coach has never touched the toggle — no row yet is not "off."
  const showTrainingMaxOnPr = coachPrefRow?.show_training_max_on_pr ?? true;

  const { data: sessionExercises } = await supabase
    .from("session_exercises")
    .select("id, exercise_name, exercise_order, tracked_fields")
    .eq("session_id", sessionId)
    .order("exercise_order", { ascending: true });

  const exerciseIds = (sessionExercises ?? []).map((e: any) => e.id);

  const [{ data: setRows }, { data: noteRows }] = await Promise.all([
    exerciseIds.length > 0
      ? supabase
          .from("set_logs")
          .select(
            "session_exercise_id, set_order, reps, weight, rpe, rir, tempo, time_seconds, height, distance, rest_seconds, pace, status"
          )
          .in("session_exercise_id", exerciseIds)
          .order("set_order", { ascending: true })
      : Promise.resolve({ data: [] }),
    exerciseIds.length > 0
      ? supabase
          .from("session_exercise_coach_notes")
          .select("session_exercise_id, body, visible_to_athlete")
          .in("session_exercise_id", exerciseIds)
      : Promise.resolve({ data: [] }),
  ]);

  const setsByExercise = new Map<string, RecapSetEntry[]>();
  for (const row of (setRows ?? []) as any[]) {
    if (row.status !== "completed") continue;
    const list = setsByExercise.get(row.session_exercise_id) ?? [];
    list.push({
      setOrder: row.set_order,
      reps: row.reps,
      weight: row.weight,
      rpe: row.rpe,
      rir: row.rir,
      tempo: row.tempo,
      timeSeconds: row.time_seconds,
      height: row.height,
      distance: row.distance,
      restSeconds: row.rest_seconds,
      pace: row.pace,
    });
    setsByExercise.set(row.session_exercise_id, list);
  }

  const noteByExercise = new Map<string, string>();
  const noteVisibilityByExercise = new Map<string, boolean>();
  for (const row of (noteRows ?? []) as any[]) {
    noteByExercise.set(row.session_exercise_id, row.body ?? "");
    noteVisibilityByExercise.set(row.session_exercise_id, !!row.visible_to_athlete);
  }

  const prNames = new Set<string>(workoutLog?.new_prs ?? []);

  // Only worth asking for exercises that actually PR'd this session —
  // the training-max estimate can only ever be "bumped by this session"
  // for one of those.
  const prExerciseNames = (sessionExercises ?? [])
    .map((ex: any) => ex.exercise_name as string)
    .filter((name: string) => prNames.has(name));

  const { data: trainingMaxRows } =
    showTrainingMaxOnPr && prExerciseNames.length > 0
      ? await supabase
          .from("athlete_training_maxes")
          .select("exercise_name, estimated_max, source_weight, source_reps, source_rpe_assumed")
          .eq("athlete_id", session.athlete_id)
          .in("exercise_name", prExerciseNames)
      : { data: [] as any[] };

  const trainingMaxByExercise = new Map<
    string,
    { estimate: number; sourceWeight: number; sourceReps: number; assumed: boolean }
  >();
  for (const row of (trainingMaxRows ?? []) as any[]) {
    trainingMaxByExercise.set(row.exercise_name, {
      estimate: row.estimated_max,
      sourceWeight: row.source_weight,
      sourceReps: row.source_reps,
      assumed: !!row.source_rpe_assumed,
    });
  }

  const exercises: RecapExercise[] = (sessionExercises ?? []).map((ex: any) => {
    const sets = setsByExercise.get(ex.id) ?? [];
    const tm = trainingMaxByExercise.get(ex.exercise_name);
    // Real correlation, not an assumption the PR and the training-max
    // bump are the same event: only true when one of THIS session's own
    // completed sets is the exact set (weight + reps) currently on
    // record as having set the estimate.
    const bumpedByThisSession =
      !!tm && sets.some((s) => s.weight === tm.sourceWeight && s.reps === tm.sourceReps);

    return {
      sessionExerciseId: ex.id,
      exerciseName: ex.exercise_name,
      trackedFields: orderTrackedFields((ex.tracked_fields ?? []) as TrackedField[]),
      sets,
      isPr: prNames.has(ex.exercise_name),
      coachNote: noteByExercise.get(ex.id) ?? "",
      visibleToAthlete: noteVisibilityByExercise.get(ex.id) ?? false,
      trainingMaxBumped: bumpedByThisSession,
      trainingMaxEstimate: bumpedByThisSession ? tm!.estimate : null,
      trainingMaxAssumedEffort: bumpedByThisSession ? tm!.assumed : false,
    };
  });

  return {
    sessionId,
    groupId: session.group_id,
    athleteId: session.athlete_id,
    athleteName: session.profiles?.full_name ?? "Athlete",
    workoutTitle: session.workouts?.title ?? "Workout",
    showTrainingMaxOnPr,
    workoutId: session.workout_id,
    completedAt: session.completed_at,
    durationSeconds: session.duration_seconds,
    totalVolume: workoutLog?.total_volume ?? 0,
    totalSetsCompleted: workoutLog?.total_sets_completed ?? 0,
    prCount: prNames.size,
    exercises,
    sessionNote: sessionNoteRow?.body ?? "",
  };
}

// Referenced by ACTUAL_PROP consumers elsewhere; kept here so callers
// don't need to know the underlying column mapping to read a set's
// value for a given tracked field.
export function recapSetValue(set: RecapSetEntry, field: TrackedField): number | string | null {
  const prop = ACTUAL_PROP[field] as keyof RecapSetEntry;
  return set[prop] as number | string | null;
}
