import Link from "next/link";
import { redirect } from "next/navigation";
import { createServerClient } from "@/lib/supabase/server";
import { CoachDesktopShell } from "@/components/coach/coach-desktop-shell";
import { ClientNutrition } from "@/components/coach/nutrition/client-nutrition";
import { ClientFoodLogOnly } from "@/components/coach/nutrition/client-food-log-only";
import { FavoriteMealsTab } from "@/components/coach/nutrition/favorite-meals-tab";
import { MacroCalculator } from "@/components/tools/macro-calculator";
import { getEffectiveAthlete } from "@/lib/acting-as";
import { ActingAsBanner } from "@/components/athlete/acting-as-banner";
import { BottomTabBar } from "@/components/athlete/bottom-tab-bar";
import { TrendChart } from "@/components/coach/desktop/trend-chart";
import { resolveDayMacros, standingForDate } from "@/lib/macro-resolution";
import { fetchStandingHistory } from "@/lib/standing-macros";
import { dateKeyInZone, getGroupCoachTimezone } from "@/lib/timezone";
import { FoodLogSection } from "@/components/athlete/food-log-section";
import type { GeneratedMeal } from "@/lib/meal-engine";
import type { MealEntryPayload } from "@/lib/meal-plan-assignment";
import { NutritionPreferencesCard } from "@/components/athlete/nutrition-preferences-card";
import { RecalcPromptCard } from "@/components/athlete/recalc-prompt-card";
import { recalcPromptFor } from "@/lib/recalc-prompt";
import { rowToPreferences } from "@/lib/nutrition-preferences";
import { filterGeneratedMealsForClient, filterPlanForClient, hidePlanRecipes } from "@/lib/plan-preference-check";
import { asWeightUnit, displayWeightValue } from "@/lib/units";
import type { FoodLogEntry } from "@/components/athlete/meal-checkoff-list";
import { computeTodaysMicronutrients } from "@/lib/todays-micronutrients";
import { LogNutrients } from "@/components/nutrition/log-nutrients";
import { fetchAgeAndSex, fetchNutrientLog } from "@/lib/nutrient-data";
import { pastDaysFor, type PlanEstimate } from "@/lib/nutrient-view";
import { NutritionYouthModeToggle } from "@/components/coach/desktop/nutrition-youth-mode-toggle";
import { dedupeRecentFoodLogs } from "@/lib/recent-food-logs";
import { getCoachClients } from "@/lib/coach-clients";
import { FOOD_TRACKING_OFF_LINE, dailyCaloriesFromLog } from "@/lib/nutrition-tracking";
import { addDaysToKey } from "@/lib/date-key";
import { fetchFoodLogDay } from "@/lib/food-entry";
import { AiBudgetMeter } from "@/components/coach/ai-budget-meter";
import { retryState as retryStateFor, type RetryState } from "@/lib/meal-plan-retry";

export default async function NutritionPage(
  props: {
    params: Promise<{ groupId: string }>;
    searchParams: Promise<{ athleteId?: string; tab?: string }>;
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
      .select("name, nutrition_youth_mode, group_kind")
      .eq("id", params.groupId)
      .single();

    // Every client the coach has, across all their groups in this organization (the same list as Clients), not just the group in the address: a one-on-one
    // client lives in their own group, so a per-group list would show one person. Picking a client uses THAT client's own group for all their data.
    const athletes = (await getCoachClients(supabase, user.id, params.groupId)).map((c) => ({
      profileId: c.id,
      fullName: c.fullName,
      groupId: c.groupId,
    }));

    // The bar at the top names the group in the address. In a one-on-one client's own group that is the client, so with nothing picked that client is the one shown (not a blank next to
    // their name), and picking someone else opens THEIR group's address below, so the name on top and the client on the page are always the same person.
    const ownClient = (group as { group_kind?: string | null } | null)?.group_kind === "one_on_one" ? athletes.find((a) => a.groupId === params.groupId) ?? null : null;
    const selected = athletes.find((a) => a.profileId === searchParams.athleteId) ?? ownClient;
    // An old bookmark or a hand-typed address for a client in another group: go to that client's own group, so the name on the top bar is theirs.
    if (selected && selected.groupId !== params.groupId) {
      redirect(`/groups/${selected.groupId}/nutrition?athleteId=${selected.profileId}${searchParams.tab ? `&tab=${searchParams.tab}` : ""}`);
    }
    let selectedTier: string | null = null;
    if (selected) {
      const { data: tierRow } = await supabase
        .from("group_memberships")
        .select("client_tier")
        .eq("group_id", selected.groupId)
        .eq("profile_id", selected.profileId)
        .maybeSingle();
      selectedTier = (tierRow?.client_tier as string | null) ?? null;
    }

    // Three tabs: Clients (a client's whole nutrition, the default), Favorite meals (the coach's own recipes) and a blank Calculator (for a prospect). The tab and
    // the redirects from the old Recipe Hub and Macro Calculator pages apply to the coach only; the client's own page below never reads `tab`.
    const tab = searchParams.tab === "favorites" || searchParams.tab === "calculator" ? searchParams.tab : "clients";
    const tabHref = (t: string) => `/groups/${params.groupId}/nutrition${t === "clients" ? "" : `?tab=${t}`}`;
    const TABS: { key: "clients" | "favorites" | "calculator"; label: string }[] = [
      { key: "clients", label: "Clients" },
      { key: "favorites", label: "Favorite meals" },
      { key: "calculator", label: "Calculator" },
    ];

    return (
      <CoachDesktopShell groupId={params.groupId} groupName={group?.name ?? "Coaching"} active="nutrition">
        <div className="pb-4 border-b border-steel/20 mb-6">
          <div className="flex items-end justify-between gap-4">
            <div>
              <h1 className="font-display font-bold text-3xl uppercase leading-none">Nutrition</h1>
              <p className="font-body text-sm text-steel mt-2 max-w-[70ch]">
                Targets, meal plans and what each client actually ate, in one place.
              </p>
            </div>
            <NutritionYouthModeToggle groupId={params.groupId} initialEnabled={group?.nutrition_youth_mode ?? false} />
          </div>
          <nav aria-label="Nutrition" className="mt-4 flex gap-1">
            {TABS.map((t) => (
              <Link
                key={t.key}
                href={tabHref(t.key)}
                aria-current={tab === t.key ? "page" : undefined}
                className={`h-9 px-4 flex items-center font-body text-sm border ${
                  tab === t.key ? "bg-rust/10 text-rust border-rust/40" : "text-steel border-steel/20 hover:text-chalk"
                }`}
              >
                {t.label}
              </Link>
            ))}
          </nav>
        </div>

        {/* Shows only when there is something to say: about 80 percent of this month's AI used, or all of it. */}
        <div className="mb-6 max-w-[70ch]">
          <AiBudgetMeter variant="banner" groupId={params.groupId} />
        </div>

        {tab === "favorites" ? (
          <FavoriteMealsTab userId={user.id} />
        ) : tab === "calculator" ? (
          <div>
            <p className="font-body text-sm text-steel mb-4 max-w-[70ch]">
              A blank calculator, for a prospect or a quick estimate. To work out a number for one of your clients, open the client and use the calculator in their Meal plan,
              which opens with their own weight and phase.
            </p>
            <MacroCalculator />
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-[220px_1fr] gap-8 items-start">
            <div className="border border-steel/20 divide-y divide-steel/15">
              {athletes.length === 0 ? (
                <p className="font-body text-sm text-steel p-3">No clients yet.</p>
              ) : (
                athletes.map((a) => (
                  <Link
                    key={a.profileId}
                    href={`/groups/${a.groupId}/nutrition?athleteId=${a.profileId}`}
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
                <p className="font-body text-sm text-steel">Pick a client to see their nutrition.</p>
              ) : selectedTier === "group" ? (
                <ClientFoodLogOnly groupId={selected.groupId} athleteId={selected.profileId} clientName={selected.fullName} />
              ) : (
                <ClientNutrition
                  groupId={selected.groupId}
                  athleteId={selected.profileId}
                  coachId={user.id}
                  clientName={selected.fullName}
                  variant="hub"
                />
              )}
            </div>
          </div>
        )}
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
  // The same calendar day the rest of the page uses (the coach's time zone), not the UTC date, so an evening in the US does not lose or gain a day at the edge.
  const thirtyDaysAgoKey = addDaysToKey(todayKey, -30);

  const { data: viewerMembership } = await supabase
    .from("group_memberships")
    .select("client_tier")
    .eq("group_id", params.groupId)
    .eq("profile_id", athleteId)
    .maybeSingle();
  const macrosEnabled = (viewerMembership?.client_tier ?? null) !== "group";
  // The coach's per-client switch for food tracking (on unless a coach turned it off). Read on its own, so a database without the column yet reads as on and the tier above
  // is never lost to a failed combined read.
  const { data: trackingRow } = await supabase
    .from("group_memberships")
    .select("food_tracking_enabled")
    .eq("group_id", params.groupId)
    .eq("profile_id", athleteId)
    .maybeSingle();
  const trackingOn = (trackingRow as { food_tracking_enabled?: boolean | null } | null)?.food_tracking_enabled !== false;

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
    { data: athleteInjuryStatus },
    { data: eatenRows },
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
    // Logging is for every client, whatever their tier: these three reads are never gated.
    // Today's entries with the searched-food detail (falls back to the original columns before the database has them).
    fetchFoodLogDay(supabase, athleteId, todayKey).then((data) => ({ data })),
    supabase
      .from("food_log_entries")
      .select("description, calories, protein_g, carbs_g, fat_g, created_at")
      .eq("athlete_id", athleteId)
      .neq("status", "skipped")
      .not("description", "is", null)
      .order("created_at", { ascending: false })
      .limit(40),
    supabase.from("athlete_injury_status").select("is_injured").eq("athlete_id", athleteId).maybeSingle(),
    supabase
      .from("food_log_entries")
      .select("log_date, status, calories")
      .eq("athlete_id", athleteId)
      .gte("log_date", thirtyDaysAgoKey)
      .order("log_date", { ascending: true }),
  ]);

  const todayFoodLog: FoodLogEntry[] = todayFoodLogRows ?? [];
  // A saved plan's meals are an OBJECT keyed by day type ({ daily | train | rest: [...] }), not a list; the checklist below wants a list, and handing it the
  // object throws on the client's page the day a coach saves a plan. So the checklist only gets a real list, and the saved plan is shown by TodaysMealCards (inside FoodLogSection).
  const todayMealsRaw: GeneratedMeal[] = Array.isArray(todayMealPlan?.meals) ? (todayMealPlan?.meals as unknown as GeneratedMeal[]) : [];
  const savedPlanMeals =
    todayMealPlan?.meals && typeof todayMealPlan.meals === "object" && !Array.isArray(todayMealPlan.meals)
      ? (todayMealPlan.meals as unknown as Record<string, MealEntryPayload[]>)
      : null;

  // The client's own food preferences, and the saved plan with anything that breaks them left out (a missing row, or a database without the table yet, is no rules).
  // A client with NO row simply has no rules. A row that could not be READ is different: nothing can be checked, so no recipe is shown (the meals say the coach is updating them).
  const { data: prefsRow, error: prefsError } = await supabase.from("client_nutrition_preferences").select("*").eq("athlete_id", athleteId).maybeSingle();
  if (prefsError) console.error("[nutrition] could not read food rules:", prefsError.message);
  const clientPrefs = rowToPreferences(prefsRow as Record<string, unknown> | null);
  const clientRules = prefsError
    ? ("unreadable" as const)
    : { allergies: clientPrefs.allergies, intolerances: clientPrefs.intolerances, dislikes: clientPrefs.dislikes, dietType: clientPrefs.dietType };
  const todayMeals = filterGeneratedMealsForClient(todayMealsRaw, clientRules);
  const clientPlan = clientRules === "unreadable" ? hidePlanRecipes(savedPlanMeals) : filterPlanForClient(savedPlanMeals, clientRules);

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

  // "Not feeling it?": only for the client themself (a coach acting as them cannot ask on their behalf), and only when there is a saved plan to change. The state is read from the plan
  // itself (the try number is written on each rebuilt day), so a coach who assigns a new plan starts the count over.
  let planRetry: RetryState | null = null;
  if (macrosEnabled && !isActingAsOther && savedPlanMeals) {
    const { data: futurePlanDays, error: futurePlanError } = await supabase.from("meal_plans").select("log_date, rationale").eq("athlete_id", athleteId).gte("log_date", todayKey).limit(62);
    if (futurePlanError) console.error("[nutrition] could not read the plan days:", futurePlanError.message);
    else planRetry = retryStateFor((futurePlanDays ?? []) as { log_date: string; rationale: string | null }[], todayKey);
  }

  const standingHistory = macrosEnabled ? await fetchStandingHistory(supabase, athleteId, params.groupId) : [];
  const todayKeyForMacros = todayKey;
  // "Are you happy with your meal plan?": only for the client themself (a coach acting as them cannot answer for them), only after a real change of target, and only until it is answered.
  let recalcPrompt: ReturnType<typeof recalcPromptFor> = null;
  if (macrosEnabled && !isActingAsOther) {
    const { data: answeredRows, error: answeredError } = await supabase
      .from("client_nutrition_feedback")
      .select("target_effective_from")
      .eq("athlete_id", athleteId)
      .eq("group_id", params.groupId);
    if (answeredError) console.error("[nutrition] could not read earlier answers:", answeredError.message);
    else recalcPrompt = recalcPromptFor(standingHistory, (answeredRows ?? []).map((r) => r.target_effective_from as string), todayKey);
  }
  const todayMacros = macrosEnabled
    ? resolveDayMacros(
        todayMacroRow ?? null,
        (todayMealPlan?.macros as any) ?? null,
        (todayMealPlan?.meals as any) ?? null,
        standingForDate(standingHistory, todayKeyForMacros)
      ).target
    : null;

  const micronutrients = macrosEnabled
    ? await computeTodaysMicronutrients(supabase, todayMeals)
    : { totals: {}, coveredIngredientCount: 0, totalIngredientCount: 0, hasAnyData: false };
  // Vitamins and minerals live WITH the food log: the 29 days before today are added up here once; today is added up in the browser as foods are logged.
  const planEstimate: PlanEstimate | null = micronutrients.hasAnyData ? { totals: micronutrients.totals, coveredIngredientCount: micronutrients.coveredIngredientCount, totalIngredientCount: micronutrients.totalIngredientCount } : null;
  const nutrientData =
    trackingOn || planEstimate
      ? await Promise.all([fetchNutrientLog(supabase, athleteId, todayKey), fetchAgeAndSex(supabase, athleteId, todayKey)]).then(([log, who]) => ({
          pastDays: pastDaysFor(log.entries, todayKey),
          age: who.age,
          sex: who.sex,
          planEstimate,
          partialLog: log.truncated,
        }))
      : null;

  // The client's own unit: stored pounds are only converted for display.
  const { data: unitRow } = await supabase.from("athlete_profile_details").select("weight_unit").eq("athlete_id", athleteId).maybeSingle();
  const weightUnit = asWeightUnit(unitRow?.weight_unit);
  const weightTrendPoints = (weightLogs ?? []).map((w) => ({ date: w.logged_date, value: displayWeightValue(w.weight, weightUnit) }));
  const caloriesEatenPoints = dailyCaloriesFromLog((eatenRows ?? []) as { log_date: string; status: string | null; calories: number | null }[]);
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

      {/* coach_em_up_finley_funston_transcript.md — real client-safety
          nudge, not a silent target change. Self-contained (no separate
          Resources-tab-articles infrastructure exists yet to route
          through), linking to one real, credible source rather than
          inventing content. */}
      {athleteInjuryStatus?.is_injured && (
        <div className="mx-5 mt-6 border border-rust/40 bg-rust/5 p-4">
          <p className="font-body text-sm text-chalk font-medium mb-1">
            Your coach has marked you as currently injured
          </p>
          <p className="font-body text-xs text-steel">
            Your calorie target has been raised to at least maintenance while you recover —
            undereating during an injury measurably slows healing.{" "}
            <a
              href="https://www.childrensmercy.org/departments-and-clinics/orthopedics/sports-medicine/nutrition-for-injury-recovery-in-athletes/"
              target="_blank"
              rel="noopener noreferrer"
              className="text-rust underline underline-offset-2"
            >
              Why eating enough matters for recovery &rarr;
            </a>
          </p>
        </div>
      )}

      {/* Every client can track what they eat here, whatever their tier and whether or not a coach has set a target. Targets, meal plans, food rules and the weekly
          check-in are a coach-run feature and show only for clients on a tier that has them. */}
      <div className="px-5 pt-6 space-y-6">
          {recalcPrompt && (
            <RecalcPromptCard athleteId={athleteId} groupId={params.groupId} effectiveFrom={recalcPrompt.effectiveFrom} calories={recalcPrompt.calories} showCalories={!youthMode} />
          )}
          {macrosEnabled && (
          <section className="border border-steel/20 p-4">
            <p className="font-body text-xs text-steel uppercase tracking-wide mb-2">
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
                      <p className="font-body text-xs text-steel uppercase mt-1">Carbs</p>
                    </div>
                    <div>
                      <p className="font-display text-lg leading-none">{todayMacros.fatG ?? "--"}</p>
                      <p className="font-body text-xs text-steel uppercase mt-1">Fat</p>
                    </div>
                  </div>
                </div>
              ) : (
                <div className="grid grid-cols-4 gap-2 text-center">
                  <div>
                    <p className="font-display text-xl leading-none">{todayMacros.calories ?? "--"}</p>
                    <p className="font-body text-xs text-steel uppercase mt-1">Kcal</p>
                  </div>
                  <div>
                    <p className="font-display text-xl leading-none">{todayMacros.proteinG ?? "--"}</p>
                    <p className="font-body text-xs text-steel uppercase mt-1">Protein</p>
                  </div>
                  <div>
                    <p className="font-display text-xl leading-none">{todayMacros.carbsG ?? "--"}</p>
                    <p className="font-body text-xs text-steel uppercase mt-1">Carbs</p>
                  </div>
                  <div>
                    <p className="font-display text-xl leading-none">{todayMacros.fatG ?? "--"}</p>
                    <p className="font-body text-xs text-steel uppercase mt-1">Fat</p>
                  </div>
                </div>
              )
            ) : (
              <p className="font-body text-sm text-steel">No targets set for today yet.</p>
            )}
          </section>
          )}

          {macrosEnabled && <NutritionPreferencesCard athleteId={athleteId} initial={clientPrefs} />}

          <section>
            <h2 className="font-display uppercase text-sm tracking-wide text-steel mb-2">
              Today&apos;s food
            </h2>
            {trackingOn ? (
              <FoodLogSection
                target={todayMacros}
                coachProgramming={macrosEnabled}
                nutrients={nutrientData}
                plan={savedPlanMeals ? { meals: clientPlan.meals, hiddenCount: clientPlan.hiddenCount, emptiedMeals: clientPlan.emptiedMeals } : null}
                planRetry={planRetry}
                athleteId={athleteId}
                groupId={params.groupId}
                logDate={todayKey}
                meals={todayMeals}
                initialEntries={todayFoodLog}
                recents={recentFoodOptions}
              />
            ) : (
              <p className="font-body text-sm text-steel border border-steel/20 p-4" data-testid="tracking-off">
                {FOOD_TRACKING_OFF_LINE}
              </p>
            )}
          </section>

          {!trackingOn && nutrientData && planEstimate && (
            <LogNutrients
              groupId={params.groupId}
              athleteId={athleteId}
              todayKey={todayKey}
              pastDays={nutrientData.pastDays}
              age={nutrientData.age}
              sex={nutrientData.sex}
              entries={[]}
              audience="client"
              planEstimate={planEstimate}
              partialLog={nutrientData.partialLog}
            />
          )}
          {macrosEnabled && (
          <section>
            <h2 className="font-display uppercase text-sm tracking-wide text-steel mb-2">
              Weekly check-in
            </h2>
            {latestCheckin ? (
              // The actual target numbers already render once, above, in
              // "Today's targets" — a check-in applies straight to
              // daily_macros, so repeating them here was a duplicate, not
              // a second signal. This card's real, non-duplicate value is
              // the *reasoning* behind the current target and when it was
              // set.
              <div className="border border-steel/20 p-4 space-y-3">
                <p className="font-body text-sm text-chalk">{latestCheckin.rationale}</p>
                <p className="font-body text-xs text-steel pt-2 border-t border-steel/15">
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
          )}

          <section>
            <h2 className="font-display uppercase text-sm tracking-wide text-steel mb-2">
              Body weight
            </h2>
            <TrendChart points={weightTrendPoints} unit={` ${weightUnit}`} />
          </section>

          <section>
            <h2 className="font-display uppercase text-sm tracking-wide text-steel mb-2">
              Calories eaten
            </h2>
            <TrendChart points={caloriesEatenPoints} unit=" cal" emptyLabel="Nothing logged in the last 30 days yet." />
          </section>

          {macrosEnabled && (
          <section>
            <h2 className="font-display uppercase text-sm tracking-wide text-steel mb-2">
              Calorie target
            </h2>
            <TrendChart points={calorieTrendPoints} unit=" cal" emptyLabel="No calorie targets set yet." />
          </section>
          )}
      </div>

      <BottomTabBar groupId={params.groupId} activeOverride="nutrition" />
    </main>
  );
}
