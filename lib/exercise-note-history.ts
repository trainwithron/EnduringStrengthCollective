// Carries a coach's per-exercise note forward onto the athlete's next
// scheduled workout — the same correlating-by-(athlete, exercise name)
// mechanism already shipped for weight suggestions
// (lib/set-suggestions.ts), applied to freeform text instead of a
// number. Looks across every session_exercise_coach_notes row for this
// athlete's own past sessions matching this exercise name, newest first,
// and returns the first one with actual content.
export interface CarriedForwardNote {
  body: string;
  date: string; // the session's own completed_at, for the "Carried forward from..." caption
}

export async function findMostRecentCoachNoteForExercise(
  supabase: any,
  { athleteId, groupId, exerciseName }: { athleteId: string; groupId: string; exerciseName: string }
): Promise<CarriedForwardNote | null> {
  const { data: rows } = await supabase
    .from("session_exercise_coach_notes")
    .select(
      "body, session_exercises!inner ( exercise_name, athlete_sessions!inner ( athlete_id, completed_at ) )"
    )
    .eq("group_id", groupId)
    .eq("session_exercises.exercise_name", exerciseName)
    .eq("session_exercises.athlete_sessions.athlete_id", athleteId);

  const withDates = ((rows ?? []) as any[])
    .filter((row) => row.body && row.body.trim())
    .map((row) => ({
      body: row.body as string,
      date: row.session_exercises.athlete_sessions.completed_at as string,
    }))
    .sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());

  return withDates[0] ?? null;
}
