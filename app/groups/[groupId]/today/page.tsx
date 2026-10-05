import { redirect } from "next/navigation";
import { createServerClient } from "@/lib/supabase/server";
import { getTodaysSessions, workoutResultFromSessions } from "@/lib/todays-workout";
import Link from "next/link";
import { Check } from "lucide-react";
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

  const sessions = await getTodaysSessions(supabase, {
    groupId: params.groupId,
    athleteId: effective.athleteId,
  });
  const result = workoutResultFromSessions(sessions);

  // One program with something to do: straight into it, as always. Two or more (a main
  // program plus mobility or a warm-up): show them all, labelled, instead of choosing for
  // the athlete and hiding the rest.
  const showList = !sessions.overrideWorkoutId && sessions.cards.length >= 2;

  if (result.status === "ready" && !showList) {
    redirect(`/groups/${params.groupId}/workouts/${result.workoutId}`);
  }

  const message =
    result.status === "locked"
      ? `Your next workout unlocks on ${formatShortDate(result.unlocksOn)}.`
      : isCoach
      ? "No active program in this group yet, or you've completed every workout in it — set one up from Programs."
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

  if (showList) {
    const firstReady = sessions.cards.findIndex((x) => x.status === "ready");
    return (
      <main className="min-h-screen bg-graphite text-chalk font-body pb-24">
        {effective.isActingAsOther && (
          <ActingAsBanner athleteFullName={actingAsFullName ?? "Client"} groupId={params.groupId} />
        )}
        <header className="px-5 pt-8 pb-4">
          <h1 className="font-display font-bold text-3xl leading-none uppercase">Today</h1>
        </header>
        <ul className="px-5 space-y-3">
          {sessions.cards.map((c, i) => (
            <li key={c.programId} className="border border-steel/20 p-4">
              <p className="font-body text-xs text-rust uppercase tracking-wide">{c.heading}</p>
              <p className="font-display font-bold text-xl uppercase leading-none mt-1">{c.title}</p>
              {c.status === "done" ? (
                <Link
                  href={`/groups/${params.groupId}/workouts/${c.workoutId}`}
                  className="mt-3 flex items-center gap-2 min-h-11 font-body text-sm text-positive"
                >
                  <Check className="w-4 h-4" strokeWidth={3} /> Done. View workout
                </Link>
              ) : (
                <Link
                  href={`/groups/${params.groupId}/workouts/${c.workoutId}`}
                  className={`mt-3 w-full h-11 flex items-center justify-center font-display uppercase text-sm font-bold ${
                    i === firstReady ? "bg-rust text-graphite" : "border border-rust text-rust"
                  }`}
                >
                  Start workout
                </Link>
              )}
            </li>
          ))}
        </ul>
        <BottomTabBar groupId={params.groupId} />
      </main>
    );
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
