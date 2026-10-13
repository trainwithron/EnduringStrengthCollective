import { redirect } from "next/navigation";
import { inOrg, orgIdOfGroup } from "@/lib/org-of-group";
import { NoAccess } from "@/components/shared/no-access";
import { createServerClient } from "@/lib/supabase/server";
import { isMemberOfGroup, NOT_IN_GROUP_MESSAGE } from "@/lib/athlete-in-group";
import { getWorkoutOverviewData } from "@/lib/workout-overview-data";
import { WorkoutOverviewView } from "@/components/logging/workout-overview-view";
import { CoachModeBar } from "@/components/coach/mobile/coach-mode-bar";

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
      <NoAccess>Only coaches can log sessions for a client.</NoAccess>
    );
  }

  if (!(await isMemberOfGroup(supabase, params.groupId, params.athleteId))) {
    return <NoAccess>{NOT_IN_GROUP_MESSAGE}</NoAccess>;
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
      <NoAccess>This workout isn&apos;t available.</NoAccess>
    );
  }

  // gym_owner_multi_trainer_session_tracking_real_prospect.md — only
  // fetched for the coach-logged path; an athlete's own self-started
  // session never spends a credit, so it has no use for session types.
  const { data: typeRows } = await inOrg(supabase.from("session_types").select("id, name").eq("coach_id", user.id), await orgIdOfGroup(supabase, params.groupId)).order("created_at", { ascending: true });

  // Back goes to the whole program (the week and day view), never to the Log page: that page used to jump straight back into today's day, which made a loop.
  const { data: programRow } = await supabase.from("workouts").select("program_id").eq("id", params.workoutId).maybeSingle();
  const logBase = `/groups/${params.groupId}/athletes/${params.athleteId}/log`;
  const backHref = programRow?.program_id ? `${logBase}?program=${programRow.program_id}` : logBase;

  return (
    <>
    <CoachModeBar groupId={params.groupId} clientName={athleteProfile?.full_name ?? "this client"} homeHref={`/groups/${params.groupId}`} />
    <WorkoutOverviewView
      data={data}
      groupId={params.groupId}
      workoutId={params.workoutId}
      athleteId={params.athleteId}
      backHref={backHref}
      loggingForName={athleteProfile?.full_name ?? "this client"}
      loggedByCoach
      sessionTypes={(typeRows ?? []).map((t) => ({ id: t.id, name: t.name }))}
    />
    </>
  );
}
