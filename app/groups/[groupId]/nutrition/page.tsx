import Link from "next/link";
import { redirect } from "next/navigation";
import { createServerClient } from "@/lib/supabase/server";
import { CoachDesktopShell } from "@/components/coach/coach-desktop-shell";
import { NutritionTools } from "@/components/coach/desktop/nutrition-tools";
import { computeWeeklyWeightTrend } from "@/lib/weight-trend";
import { getEffectiveAthlete } from "@/lib/acting-as";
import { ActingAsBanner } from "@/components/athlete/acting-as-banner";
import { BottomTabBar } from "@/components/athlete/bottom-tab-bar";
import { TrendChart } from "@/components/coach/desktop/trend-chart";
import { resolveDayMacroTarget } from "@/lib/todays-macros";
import { dateKeyInZone, getGroupCoachTimezone } from "@/lib/timezone";

export default async function NutritionPage(
  props: {
    params: Promise<{ groupId: string }>;
    searchParams: Promise<{ athleteId?: string }>;
  }
) {
  const params = await props.params;
  const searchParams = await props.searchParams;
  const supabase = await createServerClient();
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

  // A coach "acting as" a client sees that client's own athlete-facing
  // Nutrition tab below, not their own Meal Plans builder — same
  // precedence as every other role branch in this app (Feed, Calendar,
  // Home). A real coach (not acting as anyone) always gets the builder,
  // regardless of device, matching this route's existing behavior.
  const effective = await getEffectiveAthlete(params.groupId, user.id);
  const isActingAsOther = effective.isActingAsOther;

  if (membership?.role === "coach" && !isActingAsOther) {
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

  // Athlete-facing branch — the real athlete themselves, or a coach
  // "acting as" one. This tab is what the Day-card's compact macro
  // glance links into for the fuller picture (weekly check-in results
  // once Phase 4 ships, the trend behind it, today's full targets).
  const athleteId = effective.athleteId;
  const actingAsFullName = isActingAsOther
    ? (
        await supabase.from("profiles").select("full_name").eq("id", athleteId).maybeSingle()
      ).data?.full_name ?? "Client"
    : null;

  const timezone = await getGroupCoachTimezone(supabase, params.groupId);
  const todayKey = dateKeyInZone(timezone);
  const thirtyDaysAgoKey = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);

  const { data: viewerMembership } = await supabase
    .from("group_memberships")
    .select("client_tier")
    .eq("group_id", params.groupId)
    .eq("profile_id", athleteId)
    .maybeSingle();
  const macrosEnabled = (viewerMembership?.client_tier ?? null) !== "group";

  const [
    { data: todayMacroRow },
    { data: todayMealPlan },
    { data: weightLogs },
    { data: macroHistory },
  ] = await Promise.all([
    macrosEnabled
      ? supabase
          .from("daily_macros")
          .select("calories, protein_g, carbs_g, fat_g")
          .eq("athlete_id", athleteId)
          .eq("log_date", todayKey)
          .maybeSingle()
      : Promise.resolve({ data: null }),
    macrosEnabled
      ? supabase
          .from("meal_plans")
          .select("meals, macros")
          .eq("athlete_id", athleteId)
          .eq("log_date", todayKey)
          .maybeSingle()
      : Promise.resolve({ data: null }),
    supabase
      .from("body_weight_logs")
      .select("logged_date, weight")
      .eq("athlete_id", athleteId)
      .eq("group_id", params.groupId)
      .gte("logged_date", thirtyDaysAgoKey)
      .order("logged_date", { ascending: true }),
    macrosEnabled
      ? supabase
          .from("daily_macros")
          .select("log_date, calories")
          .eq("athlete_id", athleteId)
          .gte("log_date", thirtyDaysAgoKey)
          .order("log_date", { ascending: true })
      : Promise.resolve({ data: [] }),
  ]);

  const todayMacros = macrosEnabled
    ? resolveDayMacroTarget(
        todayMacroRow ?? null,
        (todayMealPlan?.macros as any) ?? null,
        (todayMealPlan?.meals as any) ?? null
      )
    : null;

  const weightTrendPoints = (weightLogs ?? []).map((w) => ({ date: w.logged_date, value: w.weight }));
  const calorieTrendPoints = (macroHistory ?? [])
    .filter((m: any) => m.calories != null)
    .map((m: any) => ({ date: m.log_date, value: m.calories }));

  return (
    <main className="min-h-screen bg-graphite text-chalk font-body pb-24">
      {isActingAsOther && (
        <ActingAsBanner athleteFullName={actingAsFullName ?? "Client"} groupId={params.groupId} />
      )}
      <header className="px-5 pt-8 pb-6 border-b border-steel/20">
        <h1 className="font-display font-bold text-4xl leading-none uppercase">Nutrition</h1>
      </header>

      {!macrosEnabled ? (
        <p className="font-body text-sm text-steel px-5 pt-6 max-w-[50ch]">
          Macro programming isn&apos;t part of your current plan.
        </p>
      ) : (
        <div className="px-5 pt-6 space-y-6">
          <section className="border border-steel/20 p-4">
            <p className="font-body text-[10px] text-steel uppercase tracking-wide mb-2">
              Today&apos;s targets
            </p>
            {todayMacros && (todayMacros.calories != null || todayMacros.proteinG != null) ? (
              <div className="grid grid-cols-4 gap-2 text-center">
                <div>
                  <p className="font-display text-xl leading-none">{todayMacros.calories ?? "--"}</p>
                  <p className="font-body text-[10px] text-steel uppercase mt-1">Kcal</p>
                </div>
                <div>
                  <p className="font-display text-xl leading-none">{todayMacros.proteinG ?? "--"}</p>
                  <p className="font-body text-[10px] text-steel uppercase mt-1">Protein</p>
                </div>
                <div>
                  <p className="font-display text-xl leading-none">{todayMacros.carbsG ?? "--"}</p>
                  <p className="font-body text-[10px] text-steel uppercase mt-1">Carbs</p>
                </div>
                <div>
                  <p className="font-display text-xl leading-none">{todayMacros.fatG ?? "--"}</p>
                  <p className="font-body text-[10px] text-steel uppercase mt-1">Fat</p>
                </div>
              </div>
            ) : (
              <p className="font-body text-sm text-steel">No targets set for today yet.</p>
            )}
          </section>

          <section>
            <h2 className="font-display uppercase text-sm tracking-wide text-steel mb-2">
              Weekly check-in
            </h2>
            <p className="font-body text-sm text-steel border border-steel/20 p-4">
              Your coach hasn&apos;t run a weekly check-in yet — once they do, the result and the
              reasoning behind it will show up here.
            </p>
          </section>

          <section>
            <h2 className="font-display uppercase text-sm tracking-wide text-steel mb-2">
              Body weight
            </h2>
            <TrendChart points={weightTrendPoints} unit=" lbs" />
          </section>

          <section>
            <h2 className="font-display uppercase text-sm tracking-wide text-steel mb-2">
              Calorie target
            </h2>
            <TrendChart points={calorieTrendPoints} unit=" cal" emptyLabel="No calorie targets set yet." />
          </section>
        </div>
      )}

      <BottomTabBar groupId={params.groupId} activeOverride="nutrition" />
    </main>
  );
}

async function NutritionSection({ groupId, athleteId }: { groupId: string; athleteId: string }) {
  const supabase = await createServerClient();
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
