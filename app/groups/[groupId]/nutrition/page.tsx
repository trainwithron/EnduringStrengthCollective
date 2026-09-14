import Link from "next/link";
import { redirect } from "next/navigation";
import { createServerClient } from "@/lib/supabase/server";
import { CoachDesktopShell } from "@/components/coach/coach-desktop-shell";
import { NutritionTools } from "@/components/coach/desktop/nutrition-tools";
import { WeeklyCheckinPanel } from "@/components/coach/desktop/weekly-checkin-panel";
import { NutritionCheckinSuggestionsList } from "@/components/coach/desktop/nutrition-checkin-suggestions-list";
import { computeWeeklyWeightTrend } from "@/lib/weight-trend";
import { computeReadinessAverage } from "@/lib/wellness";
import type { NutritionPhase } from "@/lib/nutrition-checkin";
import { getEffectiveAthlete } from "@/lib/acting-as";
import { ActingAsBanner } from "@/components/athlete/acting-as-banner";
import { BottomTabBar } from "@/components/athlete/bottom-tab-bar";
import { TrendChart } from "@/components/coach/desktop/trend-chart";
import { resolveDayMacroTarget } from "@/lib/todays-macros";
import { dateKeyInZone, getGroupCoachTimezone } from "@/lib/timezone";
import { FoodLogSection } from "@/components/athlete/food-log-section";
import { computeAdherenceDays } from "@/lib/food-log-adherence";
import type { GeneratedMeal } from "@/lib/meal-engine";
import type { FoodLogEntry } from "@/components/athlete/meal-checkoff-list";
import { computeTodaysMicronutrients } from "@/lib/todays-micronutrients";
import { Key12NutrientGrid } from "@/components/athlete/key12-nutrient-grid";
import { NutritionYouthModeToggle } from "@/components/coach/desktop/nutrition-youth-mode-toggle";
import { dedupeRecentFoodLogs } from "@/lib/recent-food-logs";

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
      .select("name, nutrition_youth_mode")
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
        <div className="pb-6 border-b border-steel/20 mb-6 flex items-end justify-between gap-4">
          <div>
            <h1 className="font-display font-bold text-3xl uppercase leading-none">Meal Plans</h1>
            <p className="font-body text-sm text-steel mt-2 max-w-[70ch]">
              Build a check-in-based macro & meal plan for a specific client.
            </p>
          </div>
          <NutritionYouthModeToggle groupId={params.groupId} initialEnabled={group?.nutrition_youth_mode ?? false} />
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

  const { data: groupRow } = await supabase
    .from("groups")
    .select("nutrition_youth_mode")
    .eq("id", params.groupId)
    .maybeSingle();
  const youthMode = groupRow?.nutrition_youth_mode ?? false;

  const [
    { data: todayMacroRow },
    { data: todayMealPlan },
    { data: weightLogs },
    { data: macroHistory },
    { data: latestCheckin },
    { data: todayFoodLogRows },
    { data: recentFoodLogRows },
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
    macrosEnabled
      ? supabase
          .from("nutrition_checkins")
          .select("new_calories, protein_g, carbs_g, fat_g, rationale, created_at")
          .eq("athlete_id", athleteId)
          .order("created_at", { ascending: false })
          .limit(1)
          .maybeSingle()
      : Promise.resolve({ data: null }),
    macrosEnabled
      ? supabase
          .from("food_log_entries")
          .select("id, meal_slot, status, description, calories, protein_g, carbs_g, fat_g")
          .eq("athlete_id", athleteId)
          .eq("log_date", todayKey)
      : Promise.resolve({ data: [] }),
    macrosEnabled
      ? supabase
          .from("food_log_entries")
          .select("description, calories, protein_g, carbs_g, fat_g, created_at")
          .eq("athlete_id", athleteId)
          .neq("status", "skipped")
          .not("description", "is", null)
          .order("created_at", { ascending: false })
          .limit(40)
      : Promise.resolve({ data: [] }),
  ]);

  const todayFoodLog: FoodLogEntry[] = (todayFoodLogRows ?? []).map((r) => ({
    id: r.id,
    mealSlot: r.meal_slot,
    status: r.status as FoodLogEntry["status"],
    description: r.description,
    calories: r.calories,
    proteinG: r.protein_g,
    carbsG: r.carbs_g,
    fatG: r.fat_g,
  }));
  const todayMeals: GeneratedMeal[] = ((todayMealPlan?.meals as any) ?? []) as GeneratedMeal[];

  const recentFoodOptions = dedupeRecentFoodLogs(
    (recentFoodLogRows ?? []).map((r) => ({
      description: r.description ?? "",
      calories: r.calories,
      proteinG: r.protein_g,
      carbsG: r.carbs_g,
      fatG: r.fat_g,
      createdAt: r.created_at,
    })),
    8
  );

  const todayMacros = macrosEnabled
    ? resolveDayMacroTarget(
        todayMacroRow ?? null,
        (todayMealPlan?.macros as any) ?? null,
        (todayMealPlan?.meals as any) ?? null
      )
    : null;

  const micronutrients = macrosEnabled
    ? await computeTodaysMicronutrients(supabase, todayMeals)
    : { totals: {}, coveredIngredientCount: 0, totalIngredientCount: 0, hasAnyData: false };

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
              youthMode ? (
                // Youth/Team mode: protein-first, no calorie-deficit framing —
                // real disordered-eating-safety design decision, see
                // calorie_tracking_ux_research_and_plan.md.
                <div>
                  <div className="text-center pb-3 mb-3 border-b border-steel/15">
                    <p className="font-display text-4xl leading-none">{todayMacros.proteinG ?? "--"}g</p>
                    <p className="font-body text-xs text-steel uppercase mt-1">Protein target</p>
                  </div>
                  <div className="grid grid-cols-2 gap-2 text-center">
                    <div>
                      <p className="font-display text-lg leading-none">{todayMacros.carbsG ?? "--"}</p>
                      <p className="font-body text-[10px] text-steel uppercase mt-1">Carbs</p>
                    </div>
                    <div>
                      <p className="font-display text-lg leading-none">{todayMacros.fatG ?? "--"}</p>
                      <p className="font-body text-[10px] text-steel uppercase mt-1">Fat</p>
                    </div>
                  </div>
                </div>
              ) : (
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
              )
            ) : (
              <p className="font-body text-sm text-steel">No targets set for today yet.</p>
            )}
          </section>

          {micronutrients.hasAnyData && (
            <Key12NutrientGrid
              totals={micronutrients.totals}
              coveredIngredientCount={micronutrients.coveredIngredientCount}
              totalIngredientCount={micronutrients.totalIngredientCount}
            />
          )}

          <section>
            <h2 className="font-display uppercase text-sm tracking-wide text-steel mb-2">
              Today&apos;s meals
            </h2>
            <FoodLogSection
              athleteId={athleteId}
              groupId={params.groupId}
              logDate={todayKey}
              meals={todayMeals}
              initialEntries={todayFoodLog}
              recents={recentFoodOptions}
            />
          </section>

          <section>
            <h2 className="font-display uppercase text-sm tracking-wide text-steel mb-2">
              Weekly check-in
            </h2>
            {latestCheckin ? (
              <div className="border border-steel/20 p-4 space-y-3">
                <p className="font-body text-sm text-chalk">{latestCheckin.rationale}</p>
                <div className="grid grid-cols-4 gap-2 text-center">
                  <div>
                    <p className="font-display text-lg leading-none">{latestCheckin.new_calories}</p>
                    <p className="font-body text-[10px] text-steel uppercase mt-1">Kcal</p>
                  </div>
                  <div>
                    <p className="font-display text-lg leading-none">{latestCheckin.protein_g}</p>
                    <p className="font-body text-[10px] text-steel uppercase mt-1">Protein</p>
                  </div>
                  <div>
                    <p className="font-display text-lg leading-none">{latestCheckin.carbs_g}</p>
                    <p className="font-body text-[10px] text-steel uppercase mt-1">Carbs</p>
                  </div>
                  <div>
                    <p className="font-display text-lg leading-none">{latestCheckin.fat_g}</p>
                    <p className="font-body text-[10px] text-steel uppercase mt-1">Fat</p>
                  </div>
                </div>
                <p className="font-body text-[11px] text-steel pt-2 border-t border-steel/15">
                  {new Date(latestCheckin.created_at).toLocaleDateString("en-US", {
                    month: "short",
                    day: "numeric",
                    year: "numeric",
                  })}
                </p>
              </div>
            ) : (
              <p className="font-body text-sm text-steel border border-steel/20 p-4">
                Your coach hasn&apos;t run a weekly check-in yet — once they do, the result and the
                reasoning behind it will show up here.
              </p>
            )}
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
  const sevenDaysAgoKey = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);

  const [
    { data: weightLogs },
    { data: existingPlan },
    { data: recentMacroRow },
    { data: wellnessRows },
    { data: lastCheckinRow },
    { data: pendingSuggestionRows },
    { data: foodLogDateRows },
  ] = await Promise.all([
    supabase
      .from("body_weight_logs")
      .select("id, logged_date, weight")
      .eq("athlete_id", athleteId)
      .eq("group_id", groupId)
      .order("logged_date", { ascending: false })
      .limit(20),
    supabase
      .from("meal_plans")
      .select("archetype, meal_count, include_snack, carb_cycling, rationale, macros, meals")
      .eq("athlete_id", athleteId)
      .eq("log_date", todayKey)
      .maybeSingle(),
    supabase
      .from("daily_macros")
      .select("calories")
      .eq("athlete_id", athleteId)
      .order("log_date", { ascending: false })
      .limit(1)
      .maybeSingle(),
    supabase
      .from("wellness_checkins")
      .select("sleep_quality, soreness, energy")
      .eq("athlete_id", athleteId)
      .eq("group_id", groupId)
      .gte("log_date", sevenDaysAgoKey),
    supabase
      .from("nutrition_checkins")
      .select("phase, consecutive_surplus_spikes, dietary_restrictions, adjustment_pct")
      .eq("athlete_id", athleteId)
      .eq("group_id", groupId)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle(),
    supabase
      .from("nutrition_checkin_suggestions")
      .select(
        "id, phase, prev_weight_lbs, curr_weight_lbs, current_calories, adherence_days, recovery_rating, consecutive_surplus_spikes, new_calories, rationale, protein_g, carbs_g, fat_g, adjustment_pct, generated_at"
      )
      .eq("athlete_id", athleteId)
      .eq("group_id", groupId)
      .eq("status", "pending")
      .order("generated_at", { ascending: false }),
    supabase
      .from("food_log_entries")
      .select("log_date")
      .eq("athlete_id", athleteId)
      .neq("status", "skipped")
      .gte("log_date", sevenDaysAgoKey),
  ]);

  const weightTrend = computeWeeklyWeightTrend(
    (weightLogs ?? []).map((w) => ({ loggedDate: w.logged_date, weight: w.weight })),
    todayKey
  );

  // A default recovery rating from the week's actual wellness check-ins
  // (same readiness math already used for the low-readiness roster
  // flag) so the coach isn't guessing a number from memory — still
  // fully editable before running the check-in.
  let defaultRecoveryRating: number | null = null;
  if (wellnessRows && wellnessRows.length > 0) {
    const avgReadiness =
      wellnessRows.reduce(
        (sum, w) =>
          sum +
          computeReadinessAverage({
            sleepQuality: w.sleep_quality,
            soreness: w.soreness,
            energy: w.energy,
          }),
        0
      ) / wellnessRows.length;
    defaultRecoveryRating = Math.min(5, Math.max(1, Math.round(avgReadiness)));
  }

  // Real adherence, derived from actual food_log_entries instead of the
  // old plain manual 1-7 entry — same "compute a real default, stay
  // fully editable" pattern as defaultRecoveryRating above.
  const defaultAdherenceDays = computeAdherenceDays(
    (foodLogDateRows ?? []).map((r) => r.log_date),
    todayKey
  );

  const lastCheckin = lastCheckinRow
    ? {
        phase: lastCheckinRow.phase as NutritionPhase,
        consecutiveSurplusSpikes: lastCheckinRow.consecutive_surplus_spikes,
        dietaryRestrictions: lastCheckinRow.dietary_restrictions ?? "",
        adjustmentPct: lastCheckinRow.adjustment_pct,
      }
    : null;

  const pendingSuggestions = (pendingSuggestionRows ?? []).map((s) => ({
    id: s.id,
    phase: s.phase,
    prevWeightLbs: s.prev_weight_lbs,
    currWeightLbs: s.curr_weight_lbs,
    currentCalories: s.current_calories,
    adherenceDays: s.adherence_days,
    recoveryRating: s.recovery_rating,
    consecutiveSurplusSpikes: s.consecutive_surplus_spikes,
    newCalories: s.new_calories,
    rationale: s.rationale,
    proteinG: s.protein_g,
    carbsG: s.carbs_g,
    fatG: s.fat_g,
    adjustmentPct: s.adjustment_pct,
    generatedAt: s.generated_at,
  }));

  return (
    <div className="space-y-8">
      <NutritionCheckinSuggestionsList
        athleteId={athleteId}
        groupId={groupId}
        initialSuggestions={pendingSuggestions}
      />
      <WeeklyCheckinPanel
        athleteId={athleteId}
        groupId={groupId}
        weekAvgWeight={weightTrend.currentAvg}
        lastWeekAvgWeight={weightTrend.previousAvg}
        defaultCurrentCalories={recentMacroRow?.calories ?? null}
        defaultRecoveryRating={defaultRecoveryRating}
        defaultAdherenceDays={defaultAdherenceDays}
        lastCheckin={lastCheckin}
      />
      <div className="pt-6 border-t border-steel/20">
        <NutritionTools
          athleteId={athleteId}
          groupId={groupId}
          date={todayKey}
          latestBodyWeight={weightLogs?.[0]?.weight ?? null}
          weightTrend={weightTrend}
          existingPlan={existingPlan ?? null}
        />
      </div>
    </div>
  );
}
