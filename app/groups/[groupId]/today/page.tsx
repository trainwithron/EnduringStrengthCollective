import { redirect } from "next/navigation";
import { createServerClient } from "@/lib/supabase/server";
import { getTodaysWorkoutId } from "@/lib/todays-workout";
import { formatShortDate } from "@/lib/program-schedule";
import { BottomTabBar } from "@/components/athlete/bottom-tab-bar";
import { ActingAsBanner } from "@/components/athlete/acting-as-banner";
import { getEffectiveAthlete } from "@/lib/acting-as";

export default async function TodayPage(
  props: {
    params: Promise<{ groupId: string }>;
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
  const isCoach = membership?.role === "coach";

  const effective = await getEffectiveAthlete(params.groupId, user.id);

  const result = await getTodaysWorkoutId(supabase, {
    groupId: params.groupId,
    athleteId: effective.athleteId,
  });

  if (result.status === "ready") {
    redirect(`/groups/${params.groupId}/workouts/${result.workoutId}`);
  }

  const message =
    result.status === "locked"
      ? `Your next workout unlocks on ${formatShortDate(result.unlocksOn)}.`
      : isCoach
      ? "No active program in this group yet, or you've completed every workout in it — set one up from the Coach Dashboard."
      : "No program assigned yet, or you've completed every workout in it. Check with your coach.";

  let actingAsFullName: string | null = null;
  if (effective.isActingAsOther) {
    const { data: profile } = await supabase
      .from("profiles")
      .select("full_name")
      .eq("id", effective.athleteId)
      .maybeSingle();
    actingAsFullName = profile?.full_name ?? "Client";
  }

  return (
    <main className="min-h-screen bg-graphite text-chalk font-body pb-24 flex flex-col">
      {effective.isActingAsOther && (
        <ActingAsBanner athleteFullName={actingAsFullName ?? "Client"} groupId={params.groupId} />
      )}
      <div className="flex-1 flex items-center justify-center px-6">
        <p className="font-body text-steel text-center max-w-[40ch]">{message}</p>
      </div>
      <BottomTabBar groupId={params.groupId} />
    </main>
  );
}
