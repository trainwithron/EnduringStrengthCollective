import Link from "next/link";
import { createServerClient } from "@/lib/supabase/server";
import { NutritionTools } from "@/components/coach/desktop/nutrition-tools";
import { WeeklyCheckinPanel } from "@/components/coach/desktop/weekly-checkin-panel";
import { NutritionCheckinSuggestionsList } from "@/components/coach/desktop/nutrition-checkin-suggestions-list";
import { NutritionSpotterPanel, type NutritionSpotterFinding } from "@/components/coach/desktop/nutrition-spotter-panel";
import { StandingMacroTargetCard } from "@/components/coach/desktop/standing-macro-target-card";
import { NutritionPhaseControl } from "@/components/coach/nutrition-phase-control";
import { CalorieFloorWarning } from "@/components/coach/nutrition/calorie-floor-warning";
import { WhatTheyAte } from "@/components/coach/nutrition/what-they-ate";
import { computeWeeklyWeightTrend } from "@/lib/weight-trend";
import { computeReadinessAverage } from "@/lib/wellness";
import type { NutritionPhase } from "@/lib/nutrition-checkin";
import {
  classifyNutritionTrend,
  isTrendAligned,
  milestoneTagToNutritionPhase,
  type MilestonePhaseTag,
} from "@/lib/nutrition-trend-classifier";
import { calorieSeriesWithStanding, resolveDayMacros, standingForDate } from "@/lib/macro-resolution";
import { fetchStandingHistory } from "@/lib/standing-macros";
import { dateKeyInZone, getGroupCoachTimezone } from "@/lib/timezone";
import { addDaysToKey, daysBetweenKeys } from "@/lib/date-key";
import { buildFoodWeek, type FoodEntryRow } from "@/lib/food-week";
import { asBiologicalSex, estimateBmr, estimateMaintenance } from "@/lib/nutrition-profile";
import { calorieFloor, floorBasisNote } from "@/lib/calorie-floor";
import {
  detectStaleMealPlan,
  detectMacroSumMismatch,
  detectRestrictedIngredientSlips,
  detectProteinTooLow,
  detectInjuredActiveDeficit,
} from "@/lib/nutrition-spotter";
import { estimateProteinFromBodyWeight } from "@/lib/macros";

const PHASE_TAG_LABEL: Record<MilestonePhaseTag, string> = { reverse_diet: "Reverse diet", cut: "Cut", bulk: "Bulk" };

function SectionHeading({ id, title, note }: { id: string; title: string; note?: string }) {
  return (
    <div id={id} className="scroll-mt-24 mb-3">
      <h2 className="font-display font-bold text-xl uppercase leading-none">{title}</h2>
      {note && <p className="font-body text-xs text-steel mt-1 max-w-[70ch]">{note}</p>}
    </div>
  );
}

// One client's whole Nutrition area, used by BOTH the Nutrition hub and the client's own profile Nutrition tab, so the two can never drift apart again. Server-fed:
// it reads what it needs for this one client, then lays out Targets, Preferences, Meal plan, What they ate and the calculator in the order a coach works.
//
// `variant="hub"` adds a sticky header (name, target, phase, floor warning); `variant="profile"` is the same content inline, with a link to open it in Nutrition.
export async function ClientNutrition({
  athleteId,
  groupId,
  coachId,
  clientName,
  variant = "hub",
}: {
  athleteId: string;
  groupId: string;
  coachId: string;
  clientName: string;
  variant?: "hub" | "profile";
}) {
  const supabase = await createServerClient();
  const timezone = await getGroupCoachTimezone(supabase, groupId);
  const todayKey = dateKeyInZone(timezone);
  const weekStartKey = addDaysToKey(todayKey, -6);
  const sixWeeksAgoKey = addDaysToKey(todayKey, -42);
  const firstName = clientName.split(" ")[0] || "this client";

  const standingHistory = await fetchStandingHistory(supabase, athleteId, groupId);
  // The target in force TODAY (what the editor shows and edits); a target scheduled for a later date is listed separately and is not mistaken for the current one.
  const standingTarget = standingForDate(standingHistory, todayKey);
  const scheduledTargets = standingHistory.filter((r) => r.effective_from > todayKey).map((r) => ({ date: r.effective_from, calories: r.calories }));

  const [
    { data: weightLogs },
    { data: existingPlan },
    { data: dayRows },
    { data: wellnessRows },
    { data: lastCheckinRow },
    { data: pendingSuggestionRows },
    { data: foodRows },
    { data: weekPlanRows },
    { data: injuryStatusRow },
    { data: bodyDetails },
    { data: intakeDob },
    { data: phaseRow },
  ] = await Promise.all([
    supabase
      .from("body_weight_logs")
      .select("id, logged_date, weight")
      .eq("athlete_id", athleteId)
      .eq("group_id", groupId)
      .order("logged_date", { ascending: false })
      .limit(60),
    supabase
      .from("meal_plans")
      .select("archetype, meal_count, include_snack, carb_cycling, rationale, macros, meals")
      .eq("athlete_id", athleteId)
      .eq("log_date", todayKey)
      .maybeSingle(),
    supabase
      .from("daily_macros")
      .select("log_date, calories, protein_g")
      .eq("athlete_id", athleteId)
      .eq("group_id", groupId)
      .not("calories", "is", null)
      .order("log_date", { ascending: true }),
    supabase
      .from("wellness_checkins")
      .select("sleep_quality, soreness, energy")
      .eq("athlete_id", athleteId)
      .eq("group_id", groupId)
      .gte("log_date", weekStartKey),
    supabase
      .from("nutrition_checkins")
      .select("phase, consecutive_surplus_spikes, dietary_restrictions, adjustment_pct, new_calories")
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
      .select("log_date, meal_slot, status, description, calories, protein_g, carbs_g, fat_g")
      .eq("athlete_id", athleteId)
      .gte("log_date", weekStartKey)
      .lte("log_date", todayKey),
    // Meal plans assigned in the last 7 days: a day's target is the client's own target, else the plan assigned to it, else the standing target (the order the client sees).
    supabase.from("meal_plans").select("log_date, macros, meals").eq("athlete_id", athleteId).gte("log_date", weekStartKey).lte("log_date", todayKey),
    // A real client-safety input: the check-in engine floors an injured client's calories at maintenance whatever the phase.
    supabase.from("athlete_injury_status").select("is_injured, surplus_pct").eq("athlete_id", athleteId).maybeSingle(),
    supabase.from("athlete_profile_details").select("height_cm, biological_sex, body_fat_pct, birthday").eq("athlete_id", athleteId).maybeSingle(),
    supabase.from("client_intake").select("date_of_birth").eq("athlete_id", athleteId).maybeSingle(),
    supabase.from("nutrition_phases").select("phase, started_at").eq("athlete_id", athleteId).eq("group_id", groupId).maybeSingle(),
  ]);

  const weightTrend = computeWeeklyWeightTrend(
    (weightLogs ?? []).map((w) => ({ loggedDate: w.logged_date, weight: w.weight })),
    todayKey
  );

  // ---- Targets: what the client has now, and the soft floor ----
  const explicitRows = (dayRows ?? []).map((r) => ({ log_date: r.log_date as string, calories: r.calories as number, protein_g: (r.protein_g as number | null) ?? null }));
  const upcomingOverrides = explicitRows.filter((r) => r.log_date >= todayKey).slice(0, 14).map((r) => ({ date: r.log_date, calories: r.calories }));
  const latestExplicit = explicitRows.length > 0 ? explicitRows[explicitRows.length - 1] : null;

  const profileInput = {
    weightLbs: weightLogs?.[0]?.weight ?? null,
    heightCm: bodyDetails?.height_cm ?? null,
    sex: bodyDetails?.biological_sex ?? null,
    dateOfBirth: (intakeDob?.date_of_birth as string | null) ?? (bodyDetails?.birthday as string | null) ?? null,
    bodyFatPct: bodyDetails?.body_fat_pct ?? null,
    todayKey,
  };
  const bmr = estimateBmr(profileInput);
  const maintenanceCalories = estimateMaintenance(profileInput);
  const floor = calorieFloor({ sex: asBiologicalSex(profileInput.sex), bmr });
  // The floor is shown only as a warning; with no sex or no BMR on file it still falls back to the base floor, never silently to nothing.
  const floorCalories = floor;
  const latestWeightDate = (weightLogs?.[0]?.logged_date as string | undefined) ?? null;
  const missingForFloor = [
    ...(profileInput.heightCm == null ? ["height"] : []),
    ...(asBiologicalSex(profileInput.sex) ? [] : ["sex"]),
    ...(profileInput.dateOfBirth ? [] : ["date of birth"]),
    ...(profileInput.weightLbs == null ? ["a weight"] : []),
  ];
  const floorNote = floorBasisNote({ bmr, weightAgeDays: latestWeightDate ? daysBetweenKeys(latestWeightDate, todayKey) : null, missing: missingForFloor, floor });

  // ---- The 7-day food view, against each day's own target ----
  const week = buildFoodWeek({
    entries: (foodRows ?? []) as FoodEntryRow[],
    todayKey,
    targetFor: (dateKey) => {
      const explicit = explicitRows.find((r) => r.log_date === dateKey);
      const plan = (weekPlanRows ?? []).find((p) => p.log_date === dateKey);
      const resolved = resolveDayMacros(
        explicit ? { calories: explicit.calories, protein_g: explicit.protein_g, carbs_g: null, fat_g: null } : null,
        (plan?.macros ?? null) as Parameters<typeof resolveDayMacros>[1],
        (plan?.meals ?? null) as Parameters<typeof resolveDayMacros>[2],
        standingForDate(standingHistory, dateKey)
      );
      return resolved.target?.calories != null ? { calories: resolved.target.calories, proteinG: resolved.target.proteinG } : null;
    },
  });

  // ---- Recovery and adherence defaults for the check-in (the coach can still edit them) ----
  let defaultRecoveryRating: number | null = null;
  if (wellnessRows && wellnessRows.length > 0) {
    const avg =
      wellnessRows.reduce(
        (sum, w) => sum + computeReadinessAverage({ sleepQuality: w.sleep_quality, soreness: w.soreness, energy: w.energy }),
        0
      ) / wellnessRows.length;
    defaultRecoveryRating = Math.min(5, Math.max(1, Math.round(avg)));
  }
  const defaultAdherenceDays = week.loggedDays;

  const isInjured = injuryStatusRow?.is_injured ?? false;
  const injurySurplusPct = injuryStatusRow?.surplus_pct ?? 0;
  const lastCheckin = lastCheckinRow
    ? {
        phase: lastCheckinRow.phase as NutritionPhase,
        consecutiveSurplusSpikes: lastCheckinRow.consecutive_surplus_spikes,
        dietaryRestrictions: lastCheckinRow.dietary_restrictions ?? "",
        adjustmentPct: lastCheckinRow.adjustment_pct,
      }
    : null;

  // ---- Phase tag and whether the trend matches it ----
  const phaseTag = (phaseRow?.phase as MilestonePhaseTag | undefined) ?? null;
  let trendAlignment: { trend: string; aligned: boolean } | null = null;
  if (phaseTag) {
    const calorieSeries = calorieSeriesWithStanding(
      explicitRows.filter((r) => r.log_date >= sixWeeksAgoKey).map((r) => ({ date: r.log_date, value: r.calories })),
      standingHistory,
      "0000-01-01",
      todayKey
    );
    const weightSeries = (weightLogs ?? [])
      .filter((w) => (w.logged_date as string) >= sixWeeksAgoKey)
      .map((w) => ({ date: w.logged_date as string, value: w.weight as number }));
    const classification = classifyNutritionTrend(calorieSeries, weightSeries, new Date());
    if (classification) trendAlignment = { trend: classification.trend, aligned: isTrendAligned(classification, phaseTag) };
  }

  // ---- The spotter's plain-language findings (no AI) ----
  const findings: NutritionSpotterFinding[] = [];
  const stale = existingPlan && lastCheckinRow ? detectStaleMealPlan(existingPlan.macros as any, lastCheckinRow.new_calories) : null;
  if (stale?.isStale && stale.planCalories !== null) {
    const direction = stale.targetCalories > stale.planCalories ? "higher" : "lower";
    findings.push({
      id: "stale-plan",
      message: `Today's saved meal plan targets ${stale.planCalories} kcal, but the most recent check-in set ${stale.targetCalories} kcal, ${stale.diffKcal} kcal ${direction} than the plan. Worth regenerating the plan to match, or confirming this gap is intentional.`,
    });
  }
  const planMacros = existingPlan?.macros as { daily?: unknown; train?: unknown; rest?: unknown } | undefined;
  const planMeals = existingPlan?.meals as { daily?: unknown[]; train?: unknown[]; rest?: unknown[] } | undefined;
  if (planMacros && planMeals) {
    const buckets: { key: "daily" | "train" | "rest"; label: string }[] = planMacros.daily
      ? [{ key: "daily", label: "day" }]
      : [
          { key: "train", label: "training day" },
          { key: "rest", label: "rest day" },
        ];
    for (const b of buckets) {
      const bucketMacros = (planMacros as any)[b.key];
      const bucketMeals = (planMeals as any)[b.key];
      if (!bucketMacros || !Array.isArray(bucketMeals) || bucketMeals.length === 0) continue;
      const result = detectMacroSumMismatch(bucketMeals, bucketMacros);
      if (result.isMismatched) {
        findings.push({
          id: `macro-sum-${b.key}`,
          message: `Today's ${b.label} meals sum to ${result.summedProtein}g protein / ${result.summedCarbs}g carbs / ${result.summedFat}g fat, but the plan's own target is ${result.targetProtein}g / ${result.targetCarbs}g / ${result.targetFat}g. Worth checking what changed.`,
        });
      }
    }
    if (lastCheckinRow?.dietary_restrictions) {
      const all = [...(planMeals.daily ?? []), ...(planMeals.train ?? []), ...(planMeals.rest ?? [])] as any[];
      for (const slip of detectRestrictedIngredientSlips(all, lastCheckinRow.dietary_restrictions)) {
        findings.push({
          id: `restricted-${slip.mealId}-${slip.matchedRestriction}`,
          message: `${slip.recipeName ?? slip.mealTitle} may contain "${slip.matchedRestriction}", flagged as a dietary restriction for this client.`,
        });
      }
    }
  }
  const proteinByDay = week.days.filter((d) => d.logged).map((d) => d.proteinG);
  const targetProtein = weightLogs?.[0]?.weight ? estimateProteinFromBodyWeight(weightLogs[0].weight) : 0;
  const proteinTooLow = detectProteinTooLow(proteinByDay, targetProtein);
  if (proteinTooLow.isLow) {
    findings.push({
      id: "protein-too-low",
      message: `Logged protein has averaged ${proteinTooLow.avgLoggedProtein}g/day over the last ${proteinTooLow.daysWithData} logged days, meaningfully under the ~${proteinTooLow.targetProtein}g/day baseline for their current body weight (${proteinTooLow.daysBelowTarget} of ${proteinTooLow.daysWithData} days under).`,
    });
  }
  if (detectInjuredActiveDeficit(isInjured, lastCheckinRow?.phase ?? null).isFlagged) {
    findings.push({
      id: "injured-active-deficit",
      message: "Marked as currently injured, but their most recent check-in still has them in a fat-loss phase. Run a new check-in to apply the maintenance floor, or confirm this is intentional.",
    });
  }

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

  const currentCalories = standingTarget?.calories ?? latestExplicit?.calories ?? null;

  return (
    <div className="space-y-10">
      <div className={variant === "hub" ? "sticky top-0 z-10 bg-graphite/95 backdrop-blur border-b border-steel/20 -mx-1 px-1 pb-3 pt-1" : "border-b border-steel/20 pb-3"}>
        <div className="flex flex-wrap items-baseline gap-x-4 gap-y-1">
          <h2 className="font-display font-bold text-2xl uppercase leading-none">{clientName}</h2>
          {standingTarget?.calories != null ? (
            <p className="font-body text-sm text-chalk [font-variant-numeric:tabular-nums]">
              Target {standingTarget.calories.toLocaleString("en-US")}
              {standingTarget.protein_g != null ? ` · P ${standingTarget.protein_g}` : ""}
              {standingTarget.carbs_g != null ? ` · C ${standingTarget.carbs_g}` : ""}
              {standingTarget.fat_g != null ? ` · F ${standingTarget.fat_g}` : ""}
            </p>
          ) : (
            <p className="font-body text-sm text-steel">No standing target yet</p>
          )}
          {phaseTag && (
            <span className="font-body text-xs text-rust border border-rust/40 px-2 py-0.5">Phase: {PHASE_TAG_LABEL[phaseTag]}</span>
          )}
          {pendingSuggestions.length > 0 && (
            <a href="#targets" className="font-body text-xs text-chalk bg-rust px-2 py-0.5">
              {pendingSuggestions.length === 1 ? "Suggestion waiting" : `${pendingSuggestions.length} suggestions waiting`}
            </a>
          )}
          {variant === "profile" && (
            <Link href={`/groups/${groupId}/nutrition?athleteId=${athleteId}`} className="font-body text-xs text-rust ml-auto">
              Open in Nutrition &rarr;
            </Link>
          )}
        </div>
        <div className="mt-1.5">
          <CalorieFloorWarning calories={currentCalories} floor={floorCalories} who={firstName} note={floorNote} />
        </div>
        <nav aria-label="Nutrition sections" className="mt-2 flex flex-wrap gap-x-4 gap-y-1 font-body text-xs text-steel">
          <a href="#targets" className="hover:text-chalk">Targets</a>
          <a href="#preferences" className="hover:text-chalk">Preferences</a>
          <a href="#meal-plan" className="hover:text-chalk">Meal plan</a>
          <a href="#what-they-ate" className="hover:text-chalk">What they ate</a>
          <a href="#macro-calculator" className="hover:text-chalk">Calculator</a>
        </nav>
      </div>

      <section>
        <SectionHeading id="targets" title="Targets" note="What they should eat each day, what the weekly check-in suggests, and where it came from." />
        <div className="space-y-6">
          <NutritionSpotterPanel findings={findings} />
          <NutritionCheckinSuggestionsList
            athleteId={athleteId}
            groupId={groupId}
            initialSuggestions={pendingSuggestions}
            todayKey={todayKey}
            floorCalories={floorCalories}
            floorNote={floorNote}
            clientName={firstName}
          />
          <StandingMacroTargetCard
            athleteId={athleteId}
            groupId={groupId}
            initial={
              standingTarget
                ? { calories: standingTarget.calories, proteinG: standingTarget.protein_g, carbsG: standingTarget.carbs_g, fatG: standingTarget.fat_g }
                : null
            }
            latestExplicit={latestExplicit ? { date: latestExplicit.log_date, calories: latestExplicit.calories } : null}
            upcomingOverrides={upcomingOverrides}
            calendarHref={`/groups/${groupId}/athletes/${athleteId}/calendar`}
            floorCalories={floorCalories}
            floorNote={floorNote}
            clientName={firstName}
            todayKey={todayKey}
            scheduled={scheduledTargets}
          />
          <div>
            <NutritionPhaseControl
              athleteId={athleteId}
              groupId={groupId}
              coachId={coachId}
              initialPhase={phaseTag}
              initialStartedAt={phaseRow?.started_at ?? null}
            />
            {trendAlignment && (
              <p className={`font-body text-xs mt-2 ${trendAlignment.aligned ? "text-positive" : "text-rust"}`}>
                {trendAlignment.aligned
                  ? "✓ Trending as expected for this phase"
                  : `⚠ Trend reads as "${trendAlignment.trend.replace("_", " ")}", which doesn't match the tagged goal yet. Worth a look.`}
              </p>
            )}
          </div>
          <details className="border border-steel/20">
            <summary className="cursor-pointer px-4 py-3 font-body text-sm text-chalk">Weekly check-in</summary>
            <div className="px-4 pb-4 pt-2 border-t border-steel/15">
              <WeeklyCheckinPanel
                athleteId={athleteId}
                groupId={groupId}
                weekAvgWeight={weightTrend.currentAvg}
                lastWeekAvgWeight={weightTrend.previousAvg}
                // The most recently set number: the standing target if it was saved after the last per-day row, otherwise that row.
                defaultCurrentCalories={
                  standingTarget?.calories != null && (!latestExplicit || standingTarget.effective_from > latestExplicit.log_date)
                    ? standingTarget.calories
                    : latestExplicit?.calories ?? standingTarget?.calories ?? null
                }
                defaultRecoveryRating={defaultRecoveryRating}
                defaultAdherenceDays={defaultAdherenceDays}
                lastCheckin={lastCheckin}
                isInjured={isInjured}
                maintenanceCalories={maintenanceCalories}
                injurySurplusPct={injurySurplusPct}
                defaultPhase={milestoneTagToNutritionPhase(phaseTag)}
                todayKey={todayKey}
                floorCalories={floorCalories}
                floorNote={floorNote}
                clientName={firstName}
              />
            </div>
          </details>
        </div>
      </section>

      <section>
        <SectionHeading id="preferences" title="Preferences" />
        <p className="font-body text-sm text-steel border border-steel/20 p-4 max-w-[70ch]">
          Likes, dislikes, allergies and meals per day are coming here next. Until then, the dietary-restrictions note in the weekly check-in and the meal plan generator is
          what the plan uses.
        </p>
      </section>

      <section>
        <SectionHeading id="meal-plan" title="Meal plan" note="Work out a target with the calculator if you need one, then build the plan from it." />
        <NutritionTools
          athleteId={athleteId}
          groupId={groupId}
          date={todayKey}
          latestBodyWeight={weightLogs?.[0]?.weight ?? null}
          weightTrend={weightTrend}
          existingPlan={existingPlan ?? null}
          defaultAdherenceDays={defaultAdherenceDays}
          defaultRecoveryRating={defaultRecoveryRating}
          defaultDietaryRestrictions={lastCheckin?.dietaryRestrictions ?? null}
          isInjured={isInjured}
          maintenanceCalories={maintenanceCalories}
          injurySurplusPct={injurySurplusPct}
          initialConsecutiveSurplusSpikes={lastCheckin?.consecutiveSurplusSpikes ?? 0}
          defaultPhase={milestoneTagToNutritionPhase(phaseTag)}
        />
      </section>

      <section>
        <SectionHeading id="what-they-ate" title="What they ate" note="The last 7 days of their food log against their target." />
        <WhatTheyAte week={week} weightTrend={weightTrend} clientName={firstName} />
      </section>
    </div>
  );
}
