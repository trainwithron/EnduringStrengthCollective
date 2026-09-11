import { redirect } from "next/navigation";
import { createServerClient } from "@/lib/supabase/server";
import { computeScheduledDates } from "@/lib/program-schedule";
import { SET_ROW_SELECT, mapSetRow, type TrackedField } from "@/lib/exercise-fields";
import { getGroupLeaderboardRankings, getPositionLeaderboardRankings } from "@/lib/leaderboard-data";
import { LiveGroupLeaderboard } from "@/components/leaderboard/live-group-leaderboard";
import { DisplayWorkoutPanel, type DisplayExercise } from "@/components/coach/desktop/display-workout-panel";
import { DisplayAutoRefresh } from "@/components/coach/display-auto-refresh";

function dateKey(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(
    d.getDate()
  ).padStart(2, "0")}`;
}

export default async function DisplayModePage(
  props: { params: Promise<{ groupId: string }> }
) {
  const params = await props.params;
  const supabase = await createServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect("/login");
  }

  const { data: membership } = await supabase
    .from("group_memberships")
    .select("role")
    .eq("group_id", params.groupId)
    .eq("profile_id", user.id)
    .maybeSingle();

  if (membership?.role !== "coach") {
    return (
      <main className="min-h-screen bg-graphite text-chalk flex items-center justify-center px-6">
        <p className="font-body text-steel text-center">
          Only coaches can open Display Mode.
        </p>
      </main>
    );
  }

  const { data: group } = await supabase
    .from("groups")
    .select("name, team_mode")
    .eq("id", params.groupId)
    .maybeSingle();

  const { data: program } = await supabase
    .from("programs")
    .select("id, name, start_date, training_days")
    .eq("group_id", params.groupId)
    .is("athlete_id", null)
    .eq("is_active", true)
    .maybeSingle();

  let todaysWorkoutTitle: string | null = null;
  let todaysExercises: DisplayExercise[] = [];

  if (program?.start_date && program.training_days) {
    const { data: workouts } = await supabase
      .from("workouts")
      .select("id, title")
      .eq("program_id", program.id)
      .order("week_number", { ascending: true })
      .order("day_index", { ascending: true });

    const scheduledDateByWorkoutId = computeScheduledDates(
      program.start_date,
      program.training_days,
      workouts ?? []
    );
    const todayKey = dateKey(new Date());
    const todaysWorkout = (workouts ?? []).find(
      (w) => scheduledDateByWorkoutId.get(w.id) && dateKey(scheduledDateByWorkoutId.get(w.id)!) === todayKey
    );

    if (todaysWorkout) {
      todaysWorkoutTitle = todaysWorkout.title;
      const { data: exerciseRows } = await supabase
        .from("group_workout_exercises")
        .select(`id, exercise_name, exercise_order, tracked_fields, group_workout_exercise_sets ( ${SET_ROW_SELECT} )`)
        .eq("workout_id", todaysWorkout.id)
        .order("exercise_order", { ascending: true });

      todaysExercises = (exerciseRows ?? []).map((e: any) => ({
        id: e.id,
        exerciseName: e.exercise_name,
        exerciseOrder: e.exercise_order,
        trackedFields: (e.tracked_fields ?? ["reps", "weight", "rpe"]) as TrackedField[],
        sets: (e.group_workout_exercise_sets ?? [])
          .slice()
          .sort((a: any, b: any) => a.set_order - b.set_order)
          .map(mapSetRow),
      }));
    }
  }

  const leaderboard = await getGroupLeaderboardRankings(supabase, params.groupId);
  const positionGroups = group?.team_mode
    ? await getPositionLeaderboardRankings(supabase, params.groupId)
    : null;

  return (
    <main className="min-h-screen bg-graphite text-chalk p-10">
      <DisplayAutoRefresh />
      <p className="font-display uppercase text-sm tracking-[0.2em] text-rust mb-8">
        {group?.name ?? "Weight Room"}
      </p>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-12">
        <div>
          {todaysWorkoutTitle ? (
            <DisplayWorkoutPanel workoutTitle={todaysWorkoutTitle} exercises={todaysExercises} />
          ) : (
            <div>
              <h2 className="font-display uppercase text-2xl tracking-wide text-chalk mb-3">
                Today
              </h2>
              <p className="font-body text-lg text-steel">No workout scheduled today.</p>
            </div>
          )}
        </div>

        <div>
          <h2 className="font-display uppercase text-2xl tracking-wide text-chalk mb-6">
            Leaderboard
          </h2>
          <LiveGroupLeaderboard
            groupId={params.groupId}
            initialRankings={leaderboard}
            initialPositionGroups={positionGroups}
            viewerId={null}
          />
        </div>
      </div>
    </main>
  );
}
