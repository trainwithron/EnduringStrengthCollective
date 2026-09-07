import { redirect } from "next/navigation";
import { createServerClient } from "@/lib/supabase/server";
import { getWorkoutOverviewData } from "@/lib/workout-overview-data";
import { WorkoutOverviewView } from "@/components/logging/workout-overview-view";
import { BottomTabBar } from "@/components/athlete/bottom-tab-bar";
import { computeScheduledDates, formatShortDate, isLocked } from "@/lib/program-schedule";

export default async function WorkoutOverviewPage({
  params,
}: {
  params: { groupId: string; workoutId: string };
}) {
  const supabase = createServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect("/login");
  }

  const data = await getWorkoutOverviewData(supabase, {
    groupId: params.groupId,
    workoutId: params.workoutId,
    athleteId: user.id,
  });

  if (!data) {
    return (
      <main className="min-h-screen bg-graphite text-chalk flex items-center justify-center px-6">
        <p className="font-body text-steel text-center">
          This workout isn&apos;t available, or you don&apos;t have access to it.
        </p>
      </main>
    );
  }

  // Content-dripping only applies to the athlete viewing their own,
  // not-yet-started upcoming workout — never to a coach, and never once a
  // session already exists for it (started early in person, say).
  const { data: membership } = await supabase
    .from("group_memberships")
    .select("role")
    .eq("group_id", params.groupId)
    .eq("profile_id", user.id)
    .maybeSingle();

  if (membership?.role === "athlete" && !data.existingSession) {
    // A coach-assigned override for this exact workout, on a date that's
    // already arrived, always unlocks it early — same rule /today already
    // applies, extended here so opening the workout's URL directly (not
    // just visiting /today) respects the same explicit assignment.
    const todayKey = new Date().toISOString().slice(0, 10);
    const { data: overrides } = await supabase
      .from("workout_assignments")
      .select("scheduled_date")
      .eq("athlete_id", user.id)
      .eq("workout_id", params.workoutId)
      .lte("scheduled_date", todayKey)
      .limit(1);

    if (overrides && overrides.length > 0) {
      return (
        <WorkoutOverviewView
          data={data}
          groupId={params.groupId}
          workoutId={params.workoutId}
          athleteId={user.id}
          backHref={`/groups/${params.groupId}/programs/${data.workout.programId}`}
        />
      );
    }

    const { data: program } = await supabase
      .from("programs")
      .select("start_date, training_days")
      .eq("id", data.workout.programId)
      .maybeSingle();

    if (program?.start_date && program.training_days && program.training_days.length > 0) {
      const { data: workouts } = await supabase
        .from("workouts")
        .select("id")
        .eq("program_id", data.workout.programId)
        .order("week_number", { ascending: true })
        .order("day_index", { ascending: true });

      const scheduledDateByDayId = computeScheduledDates(
        program.start_date,
        program.training_days,
        workouts ?? []
      );
      const scheduledDate = scheduledDateByDayId.get(params.workoutId);

      if (isLocked(scheduledDate, new Date())) {
        return (
          <main className="min-h-screen bg-graphite text-chalk font-body pb-24 flex items-center justify-center px-6">
            <p className="font-body text-steel text-center max-w-[40ch]">
              This workout unlocks on {formatShortDate(scheduledDate!)}.
            </p>
            <BottomTabBar groupId={params.groupId} activeOverride="workout" />
          </main>
        );
      }
    }
  }

  return (
    <WorkoutOverviewView
      data={data}
      groupId={params.groupId}
      workoutId={params.workoutId}
      athleteId={user.id}
      backHref={`/groups/${params.groupId}/programs/${data.workout.programId}`}
    />
  );
}
