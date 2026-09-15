import { redirect } from "next/navigation";
import { createServerClient } from "@/lib/supabase/server";
import { getWorkoutOverviewData } from "@/lib/workout-overview-data";
import { WorkoutOverviewView } from "@/components/logging/workout-overview-view";

export default async function LogWorkoutForClientPage(
  props: {
    params: Promise<{ groupId: string; athleteId: string; workoutId: string }>;
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

  // gym_owner_multi_trainer_session_tracking_real_prospect.md — only
  // fetched for the coach-logged path; an athlete's own self-started
  // session never spends a credit, so it has no use for session types.
  const { data: typeRows } = await supabase
    .from("session_types")
    .select("id, name, credit_cost")
    .eq("coach_id", user.id)
    .order("created_at", { ascending: true });

  return (
    <WorkoutOverviewView
      data={data}
      groupId={params.groupId}
      workoutId={params.workoutId}
      athleteId={params.athleteId}
      backHref={`/groups/${params.groupId}/athletes/${params.athleteId}/log`}
      loggingForName={athleteProfile?.full_name ?? "this client"}
      loggedByCoach
      sessionTypes={(typeRows ?? []).map((t) => ({ id: t.id, name: t.name, creditCost: t.credit_cost }))}
    />
  );
}
