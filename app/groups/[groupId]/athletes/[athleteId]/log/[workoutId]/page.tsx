import { redirect } from "next/navigation";
import { createServerClient } from "@/lib/supabase/server";
import { getWorkoutOverviewData } from "@/lib/workout-overview-data";
import { WorkoutOverviewView } from "@/components/logging/workout-overview-view";

export default async function LogWorkoutForClientPage({
  params,
}: {
  params: { groupId: string; athleteId: string; workoutId: string };
}) {
  const supabase = createServerClient();
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
          Only coaches can log sessions for a client.
        </p>
      </main>
    );
  }

  const { data: athleteProfile } = await supabase
    .from("profiles")
    .select("full_name")
    .eq("id", params.athleteId)
    .single();

  const data = await getWorkoutOverviewData(supabase, {
    groupId: params.groupId,
    workoutId: params.workoutId,
    athleteId: params.athleteId,
  });

  if (!data) {
    return (
      <main className="min-h-screen bg-graphite text-chalk flex items-center justify-center px-6">
        <p className="font-body text-steel text-center">
          This workout isn&apos;t available.
        </p>
      </main>
    );
  }

  return (
    <WorkoutOverviewView
      data={data}
      groupId={params.groupId}
      workoutId={params.workoutId}
      athleteId={params.athleteId}
      backHref={`/groups/${params.groupId}/athletes/${params.athleteId}/log`}
      loggingForName={athleteProfile?.full_name ?? "this client"}
      loggedByCoach
    />
  );
}
