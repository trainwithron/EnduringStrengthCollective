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
}

export interface SessionRecap {
  sessionId: string;
  groupId: string;
  athleteId: string;
  athleteName: string;
  workoutTitle: string;
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
  sessionId: string
): Promise<SessionRecap | null> {
  const [{ data: session }, { data: workoutLog }, { data: sessionNoteRow }] = await Promise.all([
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
  ]);

  if (!session) return null;

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
          .select("session_exercise_id, body")
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
  for (const row of (noteRows ?? []) as any[]) {
    noteByExercise.set(row.session_exercise_id, row.body ?? "");
  }

  const prNames = new Set<string>(workoutLog?.new_prs ?? []);

  const exercises: RecapExercise[] = (sessionExercises ?? []).map((ex: any) => ({
    sessionExerciseId: ex.id,
    exerciseName: ex.exercise_name,
    trackedFields: orderTrackedFields((ex.tracked_fields ?? []) as TrackedField[]),
    sets: setsByExercise.get(ex.id) ?? [],
    isPr: prNames.has(ex.exercise_name),
    coachNote: noteByExercise.get(ex.id) ?? "",
  }));

  return {
    sessionId,
    groupId: session.group_id,
    athleteId: session.athlete_id,
    athleteName: session.profiles?.full_name ?? "Athlete",
    workoutTitle: session.workouts?.title ?? "Workout",
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
