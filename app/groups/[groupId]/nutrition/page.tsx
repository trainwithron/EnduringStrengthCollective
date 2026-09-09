import Link from "next/link";
import { redirect } from "next/navigation";
import { createServerClient } from "@/lib/supabase/server";
import { CoachDesktopShell } from "@/components/coach/coach-desktop-shell";
import { NutritionTools } from "@/components/coach/desktop/nutrition-tools";
import { computeWeeklyWeightTrend } from "@/lib/weight-trend";

export default async function NutritionPage(
  props: {
    params: Promise<{ groupId: string }>;
    searchParams: Promise<{ athleteId?: string }>;
  }
) {
  const params = await props.params;
  const searchParams = await props.searchParams;
  const supabase = createServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) redirect("/login");

  const { data: membership } = await supabase
    .from("group_memberships")
    .select("role")
    .eq("group_id", params.groupId)
    .eq("profile_id", user.id)
    .maybeSingle();

  if (membership?.role !== "coach") {
    return (
      <main className="min-h-screen bg-graphite text-chalk flex items-center justify-center px-6">
        <p className="font-body text-steel text-center">Only coaches can build meal plans.</p>
      </main>
    );
  }

  const { data: group } = await supabase
    .from("groups")
    .select("name")
    .eq("id", params.groupId)
    .single();

  const { data: athleteRows } = await supabase
    .from("group_memberships")
    .select("profile_id, client_tier, profiles ( full_name )")
    .eq("group_id", params.groupId)
    .eq("role", "athlete")
    .order("profiles(full_name)", { ascending: true });

  const athletes = (athleteRows ?? []).map((a: any) => ({
    profileId: a.profile_id,
    fullName: a.profiles?.full_name ?? "Unknown",
    clientTier: a.client_tier as string | null,
  }));

  const selected = athletes.find((a) => a.profileId === searchParams.athleteId) ?? null;

  return (
    <CoachDesktopShell groupId={params.groupId} groupName={group?.name ?? "Coaching"} active="nutrition">
      <div className="pb-6 border-b border-steel/20 mb-6">
        <h1 className="font-display font-bold text-3xl uppercase leading-none">Meal Plans</h1>
        <p className="font-body text-sm text-steel mt-2 max-w-[70ch]">
          Build a check-in-based macro & meal plan for a specific client.
        </p>
      </div>

      <div className="grid grid-cols-[220px_1fr] gap-8 items-start">
        <div className="border border-steel/20 divide-y divide-steel/15">
          {athletes.length === 0 ? (
            <p className="font-body text-sm text-steel p-3">No clients yet.</p>
          ) : (
            athletes.map((a) => (
              <Link
                key={a.profileId}
                href={`/groups/${params.groupId}/nutrition?athleteId=${a.profileId}`}
                className={`block p-3 font-body text-sm ${
                  selected?.profileId === a.profileId ? "bg-rust/10 text-rust" : "text-chalk"
                }`}
              >
                {a.fullName}
              </Link>
            ))
          )}
        </div>

        <div>
          {!selected ? (
            <p className="font-body text-sm text-steel">Pick a client to build their meal plan.</p>
          ) : selected.clientTier === "group" ? (
            <p className="font-body text-sm text-steel">
              Macro/meal planning isn&apos;t enabled for group-tier clients.
            </p>
          ) : (
            <NutritionSection groupId={params.groupId} athleteId={selected.profileId} />
          )}
        </div>
      </div>
    </CoachDesktopShell>
  );
}

async function NutritionSection({ groupId, athleteId }: { groupId: string; athleteId: string }) {
  const supabase = createServerClient();
  const todayKey = new Date().toISOString().slice(0, 10);

  const { data: weightLogs } = await supabase
    .from("body_weight_logs")
    .select("id, logged_date, weight")
    .eq("athlete_id", athleteId)
    .eq("group_id", groupId)
    .order("logged_date", { ascending: false })
    .limit(20);

  const weightTrend = computeWeeklyWeightTrend(
    (weightLogs ?? []).map((w) => ({ loggedDate: w.logged_date, weight: w.weight })),
    todayKey
  );

  const { data: existingPlan } = await supabase
    .from("meal_plans")
    .select("archetype, meal_count, include_snack, carb_cycling, rationale, macros, meals")
    .eq("athlete_id", athleteId)
    .eq("log_date", todayKey)
    .maybeSingle();

  return (
    <NutritionTools
      athleteId={athleteId}
      groupId={groupId}
      date={todayKey}
      latestBodyWeight={weightLogs?.[0]?.weight ?? null}
      weightTrend={weightTrend}
      existingPlan={existingPlan ?? null}
    />
  );
}
