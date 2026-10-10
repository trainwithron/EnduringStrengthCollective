import { NextResponse } from "next/server";
import { createServerClient } from "@/lib/supabase/server";
import { ACTUAL_COLUMN } from "@/lib/exercise-fields";
import { PRIOR_SETS_SELECT, suggestedWeightsFromHistory } from "@/lib/suggested-weights";
import { hasAnyLogged, shapeLogged } from "@/lib/day-logged";

// One day of a CLIENT'S OWN program, for the coach's builder: the numbers the client logged on it (a day already done) or, for a day not done yet, the gray weight suggestion the
// client will see when logging (the very same function the client's workout screen uses). Only the group's coach can ask (the reads use the coach's own access); a shared group
// program has no single client, so it returns nothing. Read on demand, one day at a time, so a long program never loads every logged set.
export async function GET(request: Request) {
  const supabase = await createServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });

  const workoutId = new URL(request.url).searchParams.get("workoutId") ?? "";
  if (!workoutId) return NextResponse.json({ error: "Missing workoutId." }, { status: 400 });

  const { data: workout } = await supabase
    .from("workouts")
    .select(
      `id, group_id, program_id,
       programs!inner ( athlete_id ),
       group_workout_exercises ( id, exercise_name, group_workout_exercise_sets ( id, set_order, target_reps, target_weight, target_rpe, target_rir ) )`
    )
    .eq("id", workoutId)
    .maybeSingle();
  if (!workout) return NextResponse.json({ logged: {}, suggestions: {} });

  const { data: coach } = await supabase.from("group_memberships").select("role").eq("group_id", workout.group_id).eq("profile_id", user.id).maybeSingle();
  if (coach?.role !== "coach") return NextResponse.json({ error: "Only the group's coach can see this." }, { status: 403 });

  const athleteId = (workout as any).programs?.athlete_id as string | null;
  if (!athleteId) return NextResponse.json({ logged: {}, suggestions: {} });

  const exercises = ((workout as any).group_workout_exercises ?? []) as {
    id: string;
    exercise_name: string;
    group_workout_exercise_sets: { id: string; set_order: number; target_reps: string | null; target_weight: number | null; target_rpe: number | null; target_rir: number | null }[];
  }[];
  const names = Array.from(new Set(exercises.map((e) => e.exercise_name)));
  const loggedColumns = Array.from(new Set(["set_order", ...Object.values(ACTUAL_COLUMN)])).join(", ");

  // The day's own logged sets and the client's history (for the suggestion) are independent: one round.
  const [loggedResult, historyResult] = await Promise.all([
    supabase
      .from("set_logs")
      .select(`${loggedColumns}, session_exercises!inner ( group_workout_exercise_id, athlete_sessions!inner ( athlete_id, workout_id ) )`)
      .eq("session_exercises.athlete_sessions.athlete_id", athleteId)
      .eq("session_exercises.athlete_sessions.workout_id", workoutId)
      .eq("status", "completed"),
    names.length > 0
      ? supabase
          .from("set_logs")
          .select(PRIOR_SETS_SELECT)
          .in("session_exercises.exercise_name", names)
          .eq("session_exercises.athlete_sessions.athlete_id", athleteId)
          .eq("status", "completed")
          .order("completed_at", { ascending: false })
      : Promise.resolve({ data: [] as any[] }),
  ]);

  const logged = shapeLogged((loggedResult.data ?? []) as any[]);
  if (hasAnyLogged(logged)) return NextResponse.json({ logged, suggestions: {} });

  const suggestionMap = await suggestedWeightsFromHistory(
    supabase,
    exercises.map((ex) => ({
      exerciseName: ex.exercise_name,
      sets: ex.group_workout_exercise_sets.map((s) => ({ id: s.id, targetReps: s.target_reps, targetRpe: s.target_rpe, targetRir: s.target_rir, targetWeight: s.target_weight })),
    })),
    (historyResult.data ?? []) as any[]
  );
  return NextResponse.json({ logged: {}, suggestions: Object.fromEntries(suggestionMap) });
}
