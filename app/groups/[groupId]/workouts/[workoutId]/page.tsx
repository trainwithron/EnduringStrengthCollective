import { redirect } from "next/navigation";
import { createServerClient } from "@/lib/supabase/server";
import { getWorkoutOverviewData } from "@/lib/workout-overview-data";
import { WorkoutOverviewView } from "@/components/logging/workout-overview-view";
import { BottomTabBar } from "@/components/athlete/bottom-tab-bar";
import { ActingAsBanner } from "@/components/athlete/acting-as-banner";
import { computeScheduledDates, formatShortDate, isLocked } from "@/lib/program-schedule";
import { getEffectiveAthlete } from "@/lib/acting-as";
import { dateKeyInZone, getGroupCoachTimezone, nowInZone } from "@/lib/timezone";

export default async function WorkoutOverviewPage(
  props: {
    params: Promise<{ groupId: string; workoutId: string }>;
  }
) {
  const params = await props.params;
  const supabase = await createServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect("/login");
  }

  const effective = await getEffectiveAthlete(params.groupId, user.id);
  let actingAsFullName: string | null = null;
  if (effective.isActingAsOther) {
    const { data: profile } = await supabase
      .from("profiles")
      .select("full_name")
      .eq("id", effective.athleteId)
      .maybeSingle();
    actingAsFullName = profile?.full_name ?? "Client";
  }
  const actingAs = effective.isActingAsOther
    ? { fullName: actingAsFullName ?? "Client", groupId: params.groupId }
    : undefined;

  const data = await getWorkoutOverviewData(supabase, {
    groupId: params.groupId,
    workoutId: params.workoutId,
    athleteId: effective.athleteId,
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
  // not-yet-started upcoming workout — never to a coach (including a
  // coach currently "acting as" a client — real coach role always wins,
  // matching the "coach is never locked out" rule used elsewhere in this
  // app), and never once a session already exists for it (started early
  // in person, say).
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
    const timezone = await getGroupCoachTimezone(supabase, params.groupId);
    const todayKey = dateKeyInZone(timezone);
    const { data: overrides } = await supabase
      .from("workout_assignments")
      .select("scheduled_date")
      .eq("athlete_id", effective.athleteId)
      .eq("workout_id", params.workoutId)
      .lte("scheduled_date", todayKey)
      .limit(1);

    if (overrides && overrides.length > 0) {
      return (
        <WorkoutOverviewView
          data={data}
          groupId={params.groupId}
          workoutId={params.workoutId}
          athleteId={effective.athleteId}
          backHref={`/groups/${params.groupId}/programs/${data.workout.programId}`}
          actingAs={actingAs}
        />
      );
    }

    const { data: program } = await supabase
      .from("programs")
      .select("start_date, training_days, visibility_window")
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

      if (isLocked(scheduledDate, nowInZone(timezone), program.visibility_window)) {
        return (
          <main className="min-h-screen bg-graphite text-chalk font-body pb-24 flex flex-col">
            {actingAs && <ActingAsBanner athleteFullName={actingAs.fullName} groupId={actingAs.groupId} />}
            <div className="flex-1 flex items-center justify-center px-6">
              <p className="font-body text-steel text-center max-w-[40ch]">
                This workout unlocks on {formatShortDate(scheduledDate!)}.
              </p>
            </div>
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
      athleteId={effective.athleteId}
      backHref={`/groups/${params.groupId}/programs/${data.workout.programId}`}
      actingAs={actingAs}
    />
  );
}
