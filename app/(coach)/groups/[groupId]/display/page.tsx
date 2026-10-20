import { LoadFailedPage } from "@/components/ui/load-failed-page";
import { isReadFailure } from "@/lib/read-failed";
import { redirect } from "next/navigation";
import { NoAccess } from "@/components/shared/no-access";
import { createServerClient } from "@/lib/supabase/server";
import { computeScheduledDates } from "@/lib/program-schedule";
import { loadDoneAt, pickUpWhereLeftOff } from "@/lib/program-pickup";
import { SET_ROW_SELECT, mapSetRow, DEFAULT_TRACKED_FIELDS, type TrackedField } from "@/lib/exercise-fields";
import { loadNameProtectedIds } from "@/lib/minor-names";
import { getGroupLeaderboardRankings, getPositionLeaderboardRankings } from "@/lib/leaderboard-data";
import { LiveGroupLeaderboard } from "@/components/leaderboard/live-group-leaderboard";
import { DisplayWorkoutPanel, type DisplayExercise } from "@/components/coach/desktop/display-workout-panel";
import { DisplayAutoRefresh } from "@/components/coach/display-auto-refresh";

export const metadata = { title: "Display" };

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

  const { data: membership, error: membershipError } = await supabase
    .from("group_memberships")
    .select("role")
    .eq("group_id", params.groupId)
    .eq("profile_id", user.id)
    .maybeSingle();

  if (isReadFailure(membershipError)) return <LoadFailedPage />;

  if (membership?.role !== "coach") {
    return (
      <NoAccess>Only coaches can open Display Mode.</NoAccess>
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
    .is("archived_at", null)
    .eq("is_active", true)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  let todaysWorkoutTitle: string | null = null;
  let todaysExercises: DisplayExercise[] = [];

  if (program) {
    const { data: workouts } = await supabase
      .from("workouts")
      .select("id, title, scheduled_date, week_number, day_index")
      .eq("program_id", program.id)
      .order("week_number", { ascending: true })
      .order("day_index", { ascending: true });

    let todaysWorkout: { id: string; title: string } | undefined;
    if (program.start_date && program.training_days && program.training_days.length > 0) {
      const scheduledDateByWorkoutId = computeScheduledDates(
        program.start_date,
        program.training_days,
        (workouts ?? []).map((w) => ({ id: w.id, scheduledDate: w.scheduled_date }))
      );
      const todayKey = dateKey(new Date());
      todaysWorkout = (workouts ?? []).find(
        (w) => scheduledDateByWorkoutId.get(w.id) && dateKey(scheduledDateByWorkoutId.get(w.id)!) === todayKey
      );
    } else {
      // A program with no dates (the coach did not put it on days): the screen shows the workout the coach is up to in it, the same pointer the program view opens on.
      const { doneAt } = await loadDoneAt(supabase, user.id, (workouts ?? []).map((w) => w.id as string));
      const pick = pickUpWhereLeftOff((workouts ?? []) as { id: string; title: string | null; week_number: number | null; day_index: number | null }[], doneAt);
      if (pick.kind === "next") todaysWorkout = (workouts ?? []).find((w) => w.id === pick.workout.id);
    }

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
        trackedFields: (e.tracked_fields ?? DEFAULT_TRACKED_FIELDS) as TrackedField[],
        sets: (e.group_workout_exercise_sets ?? [])
          .slice()
          .sort((a: any, b: any) => a.set_order - b.set_order)
          .map(mapSetRow),
      }));
    }
  }

  const leaderboard = await getGroupLeaderboardRankings(supabase, params.groupId, loadNameProtectedIds);
  const positionGroups = group?.team_mode
    ? await getPositionLeaderboardRankings(supabase, params.groupId, loadNameProtectedIds)
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
