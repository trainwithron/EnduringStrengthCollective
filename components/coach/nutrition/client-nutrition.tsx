import Link from "next/link";
import { createServerClient } from "@/lib/supabase/server";
import { NutritionTools } from "@/components/coach/desktop/nutrition-tools";
import { WeeklyCheckinPanel } from "@/components/coach/desktop/weekly-checkin-panel";
import { NutritionCheckinSuggestionsList } from "@/components/coach/desktop/nutrition-checkin-suggestions-list";
import { NutritionSpotterPanel, type NutritionSpotterFinding } from "@/components/coach/desktop/nutrition-spotter-panel";
import { StandingMacroTargetCard } from "@/components/coach/desktop/standing-macro-target-card";
import { CalorieFloorWarning } from "@/components/coach/nutrition/calorie-floor-warning";
import { WhatTheyAte } from "@/components/coach/nutrition/what-they-ate";
import { NutrientsSection } from "@/components/nutrition/nutrients-section";
import { GroceryListSection } from "@/components/coach/nutrition/grocery-list-section";
import { FoodTrackingSwitch } from "@/components/coach/nutrition/food-tracking-switch";
import { PreferencesSection } from "@/components/coach/nutrition/preferences-section";
import { ClientAnswersPanel } from "@/components/coach/nutrition/client-answers-panel";
import type { RecalcAnswer } from "@/lib/recalc-prompt";
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
import { ageOnDate, asBiologicalSex, estimateBmr, estimateMaintenance } from "@/lib/nutrition-profile";
import { calorieFloor, floorBasisNote } from "@/lib/calorie-floor";
import {
  detectStaleMealPlan,
  detectMacroSumMismatch,
  detectRestrictedIngredientSlips,
  detectProteinTooLow,
  detectInjuredActiveDeficit,
} from "@/lib/nutrition-spotter";
import { hasFoodRules, proteinGramsForWeight, restrictionsTextFromPreferences, rowToPreferences } from "@/lib/nutrition-preferences";
import { checkPlanAgainstPreferences, describeFlagged, flaggedDays } from "@/lib/plan-preference-check";
import { shortDateLabel } from "@/lib/apply-from";
import { BodyProfileEditor } from "@/components/coach/nutrition/body-profile-editor";
import { BaselinePrompt } from "@/components/coach/nutrition/baseline-prompt";
import { PhaseOfRecordCard } from "@/components/coach/nutrition/phase-of-record-card";
import { readDateOfBirth, rowToBodyProfile } from "@/lib/client-body-profile";
import { minorSafetyLine } from "@/lib/minor-safety";
import { rowToPhasePlan, resolvePhaseOfRecord, reviewIsDue } from "@/lib/phase-plan";
import { chooseBaselinePhase, computeBaseline } from "@/lib/nutrition-baseline";
import { PhaseReviewCard, type PhaseReviewCardProps } from "@/components/coach/nutrition/phase-review-card";
import { buildPhaseReview, pathAssessment, reviewWindowStart } from "@/lib/phase-review";
import { factsFromReview, draftsFor } from "@/lib/phase-review-drafts";
import { resultLines, stanceLine, verdictLine } from "@/lib/phase-review-view";
import { moveState } from "@/lib/phase-move";

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
    { data: prefsRow, error: prefsReadError },
    { data: upcomingPlanRows },
    { data: injuryStatusRow },
    { data: bodyDetails },
    { data: intakeDob },
    { data: phaseRow },
    { data: phasePlanRow },
    { data: goalRows },
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
        "id, kind, below_floor, phase, prev_weight_lbs, curr_weight_lbs, current_calories, adherence_days, recovery_rating, consecutive_surplus_spikes, new_calories, rationale, protein_g, carbs_g, fat_g, adjustment_pct, generated_at"
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
    // The client's food preferences and protein rules (one row per CLIENT; a missing row, or a database without the table yet, is the defaults).
    supabase.from("client_nutrition_preferences").select("*").eq("athlete_id", athleteId).maybeSingle(),
    // The plans assigned for the next two weeks, checked again against those preferences (an allergy added after a plan was assigned).
    supabase.from("meal_plans").select("log_date, meals").eq("athlete_id", athleteId).gte("log_date", todayKey).lte("log_date", addDaysToKey(todayKey, 13)).order("log_date", { ascending: true }),
    // A real client-safety input: the check-in engine floors an injured client's calories at maintenance whatever the phase.
    supabase.from("athlete_injury_status").select("is_injured, surplus_pct").eq("athlete_id", athleteId).maybeSingle(),
    supabase.from("athlete_profile_details").select("*").eq("athlete_id", athleteId).maybeSingle(),
    supabase.from("client_intake").select("date_of_birth").eq("athlete_id", athleteId).maybeSingle(),
    supabase.from("nutrition_phases").select("phase, started_at").eq("athlete_id", athleteId).eq("group_id", groupId).maybeSingle(),
    // The phase of record (coach-only) and the goals the client and coach have agreed or proposed.
    supabase.from("client_phase_plans").select("*").eq("athlete_id", athleteId).eq("group_id", groupId).maybeSingle(),
    supabase.from("client_goals").select("goal_type, status, nutrition_phase, created_at, created_by, athlete_id").eq("athlete_id", athleteId).eq("group_id", groupId),
  ]);
  // What the client answered to "are you happy with your meal plan?" after a new target (newest first; a failed read is no answers, never a failed page).
  const { data: answerRows, error: answersError } = await supabase
    .from("client_nutrition_feedback")
    .select("id, target_effective_from, happy, change_text, requests_text, boring, status, created_at")
    .eq("athlete_id", athleteId)
    .eq("group_id", groupId)
    .order("created_at", { ascending: false })
    .limit(10);
  if (answersError) console.error("[client-nutrition] could not read the client's answers:", answersError.message);
  const answers: RecalcAnswer[] = (answerRows ?? []).map((r) => ({
    id: r.id as string,
    happy: !!r.happy,
    changeText: (r.change_text as string | null) ?? "",
    requestsText: (r.requests_text as string | null) ?? "",
    boring: !!r.boring,
    status: r.status === "handled" ? "handled" : "new",
    targetEffectiveFrom: r.target_effective_from as string,
    createdAt: r.created_at as string,
  }));
  // The target in force today as whole numbers, when all four are set (scaling a plan needs every one).
  const scaleTarget =
    standingTarget && standingTarget.calories != null && standingTarget.protein_g != null && standingTarget.carbs_g != null && standingTarget.fat_g != null
      ? { calories: Math.round(standingTarget.calories), protein: Math.round(standingTarget.protein_g), carbs: Math.round(standingTarget.carbs_g), fats: Math.round(standingTarget.fat_g) }
      : null;
  const bodyProfile = rowToBodyProfile(bodyDetails as Record<string, unknown> | null, intakeDob as Record<string, unknown> | null);
  const phasePlan = rowToPhasePlan(phasePlanRow as Record<string, unknown> | null);

  // A client with no row simply has no saved rules. A row that could not be READ is different: the planner builds nothing then (it would be made without their allergies).
  if (prefsReadError) console.error("[client-nutrition] could not read food rules:", prefsReadError.message);
  const prefs = rowToPreferences(prefsRow as Record<string, unknown> | null);
  const foodRules = { allergies: prefs.allergies, intolerances: prefs.intolerances, dislikes: prefs.dislikes, dietType: prefs.dietType };
  const rulesText = hasFoodRules(prefs) ? restrictionsTextFromPreferences(prefs) : "";
  let updatedByName: string | null = null;
  if (prefs.updatedBy) {
    const { data: who } = await supabase.from("profiles").select("full_name").eq("id", prefs.updatedBy).maybeSingle();
    updatedByName = who?.full_name ?? null;
  }
  const flaggedAssigned = hasFoodRules(prefs) ? flaggedDays((upcomingPlanRows ?? []) as { log_date: string; meals: unknown }[], foodRules) : [];
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
    heightCm: bodyProfile.heightCm,
    sex: bodyProfile.sex,
    // One reader for the date of birth: the intake's, else the profile's own.
    dateOfBirth: readDateOfBirth(bodyProfile),
    bodyFatPct: bodyProfile.bodyFatPct,
    todayKey,
    activity: bodyProfile.activity,
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
    if (hasFoodRules(prefs)) {
      for (const f of checkPlanAgainstPreferences(existingPlan?.meals as Record<string, never[]> | null, foodRules).slice(0, 5)) {
        findings.push({ id: `pref-${f.bucket}-${f.mealId}-${f.choiceIndex}`, message: `Today's plan: ${describeFlagged(f)}. ${f.safety ? "The client does not see it." : ""}`.trim() });
      }
    } else if (lastCheckinRow?.dietary_restrictions) {
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
  const proteinGrams = weightLogs?.[0]?.weight ? proteinGramsForWeight(prefs, weightLogs[0].weight) : { targetG: 0, floorG: 0 };
  const proteinTooLow = detectProteinTooLow(proteinByDay, proteinGrams.targetG, proteinGrams.floorG);
  if (proteinTooLow.isLow) {
    findings.push({
      id: "protein-too-low",
      message: `Logged protein has averaged ${proteinTooLow.avgLoggedProtein}g/day over the last ${proteinTooLow.daysWithData} logged days. That is below their protein floor of ${proteinTooLow.floorProtein}g (the target is ${proteinTooLow.targetProtein}g): ${proteinTooLow.daysBelowTarget} of ${proteinTooLow.daysWithData} days were under the floor.`,
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
    kind: (s.kind === "baseline" ? "baseline" : "weekly") as "weekly" | "baseline",
    belowFloor: !!s.below_floor,
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

  // The phase of record (the saved plan, else the latest check-in's phase, else the milestone tag), and the starting target the calculator would suggest for a client with
  // no target yet. The baseline's phase comes from the saved plan, else the goal they and their coach agreed (or proposed), else maintenance.
  const derivedPhase = phasePlan ? null : resolvePhaseOfRecord({ plan: null, latestCheckinPhase: lastCheckinRow?.phase ?? null, milestoneTag: phaseTag });
  const chosenBaseline = chooseBaselinePhase(phasePlan, (goalRows ?? []) as { goal_type: string; status: string; nutrition_phase?: string | null; created_at?: string | null }[]);
  const baselinePhase = chosenBaseline.phase;
  const baselinePhaseNote = chosenBaseline.note;
  const baselineOutcome = computeBaseline({
    weightLbs: weightLogs?.[0]?.weight != null ? Number(weightLogs[0].weight) : null,
    heightCm: bodyProfile.heightCm,
    sex: bodyProfile.sex,
    dateOfBirth: readDateOfBirth(bodyProfile),
    bodyFatPct: bodyProfile.bodyFatPct,
    activity: bodyProfile.activity,
    phase: baselinePhase,
    todayKey,
    proteinGPerLb: prefs.proteinGPerLb,
    carbSplit: prefs.carbSplit,
    dietType: prefs.dietType,
  });
  const baselineArchetype = prefs.dietType === "keto" ? "keto" : prefs.dietType === "carnivore" ? "carnivore" : "standard";
  const ageYears = readDateOfBirth(bodyProfile) ? ageOnDate(readDateOfBirth(bodyProfile) as string, todayKey) : null;
  const minorLine = minorSafetyLine({ ageYears, phase: phasePlan?.phase ?? derivedPhase?.phase ?? milestoneTagToNutritionPhase(phaseTag), clientName: firstName });
  const dobLabel = readDateOfBirth(bodyProfile) ? shortDateLabel(readDateOfBirth(bodyProfile) as string) : null;

  // The phase review: on the review date the coach sees what actually happened over the phase. It only raises a prompt; nothing changes until the coach picks a choice.
  let reviewCard: PhaseReviewCardProps | null = null;
  if (phasePlan && reviewIsDue(phasePlan, todayKey)) {
    const lastReviewedOn = phasePlan.lastReviewedAt ? phasePlan.lastReviewedAt.slice(0, 10) : null;
    const windowStart = reviewWindowStart(phasePlan.startedOn, lastReviewedOn, todayKey);
    const { data: loggedRows } = await supabase.from("food_log_entries").select("log_date").eq("athlete_id", athleteId).neq("status", "skipped").gte("log_date", windowStart).lte("log_date", todayKey);
    const review = buildPhaseReview({
      phase: phasePlan.phase,
      startedOn: phasePlan.startedOn,
      lastReviewedOn,
      todayKey,
      weights: (weightLogs ?? []).map((w) => ({ loggedDate: w.logged_date as string, weight: Number(w.weight) })),
      daysLogged: new Set((loggedRows ?? []).map((r) => r.log_date as string)).size,
      calories: currentCalories,
      floorCalories,
    });
    const next = phasePlan.plannedNextPhase;
    const assessment = next ? pathAssessment({ review, target: next, bodyFatPct: bodyProfile.bodyFatPct, sex: asBiologicalSex(bodyProfile.sex) }) : null;
    const facts = factsFromReview(review, firstName, bodyProfile.weightUnit);
    reviewCard = {
      athleteId,
      groupId,
      coachId,
      clientFirst: firstName,
      todayKey,
      phase: phasePlan.phase,
      headline: `Review ${phasePlan.reviewOn && phasePlan.reviewOn < todayKey ? "was due" : "is due"} ${shortDateLabel(phasePlan.reviewOn as string)}`,
      results: resultLines(review, bodyProfile.weightUnit),
      verdictLine: verdictLine(review, firstName),
      verdict: review.verdict,
      next,
      stance: assessment?.stance ?? null,
      stanceLine: assessment && next ? stanceLine(assessment, phasePlan.phase, next) : null,
      factors: assessment?.factors ?? [],
      moveState: moveState((goalRows ?? []) as Parameters<typeof moveState>[0], phasePlan),
      drafts: draftsFor(review, facts, assessment?.stance ?? null, next),
    };
  }

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
          {minorLine && (
            <p className="font-body text-xs text-rust mt-1" role="note">
              {minorLine}
            </p>
          )}
        </div>
        <nav aria-label="Nutrition sections" className="mt-2 flex flex-wrap gap-x-4 gap-y-1 font-body text-xs text-steel">
          <a href="#targets" className="hover:text-chalk">Targets</a>
          <a href="#preferences" className="hover:text-chalk">Preferences</a>
          <a href="#meal-plan" className="hover:text-chalk">Meal plan</a>
          <a href="#what-they-ate" className="hover:text-chalk">What they ate</a>
          <a href="#nutrients" className="hover:text-chalk">Nutrients</a>
          <a href="#macro-calculator" className="hover:text-chalk">Calculator</a>
        </nav>
      </div>

      <FoodTrackingSwitch athleteId={athleteId} groupId={groupId} clientName={clientName} />

      <section>
        <SectionHeading id="targets" title="Targets" note="What they should eat each day, what the weekly check-in suggests, and where it came from." />
        <div className="space-y-6">
          {reviewCard && <PhaseReviewCard {...reviewCard} />}
          <NutritionSpotterPanel findings={findings} />
          <BodyProfileEditor
            athleteId={athleteId}
            groupId={groupId}
            clientName={firstName}
            initial={{ heightCm: bodyProfile.heightCm, sex: bodyProfile.sex, bodyFatPct: bodyProfile.bodyFatPct, activity: bodyProfile.activity, weightUnit: bodyProfile.weightUnit }}
            dateOfBirthLabel={dobLabel}
            latestWeightLbs={weightLogs?.[0]?.weight != null ? Number(weightLogs[0].weight) : null}
            latestWeightDate={latestWeightDate}
          />
          <BaselinePrompt
            athleteId={athleteId}
            groupId={groupId}
            clientName={firstName}
            outcome={baselineOutcome}
            phaseNote={baselinePhaseNote}
            archetype={baselineArchetype}
            hasStanding={standingTarget?.calories != null}
            hasPendingBaseline={pendingSuggestions.some((p) => p.kind === "baseline")}
          />
          <NutritionCheckinSuggestionsList
            athleteId={athleteId}
            groupId={groupId}
            initialSuggestions={pendingSuggestions}
            todayKey={todayKey}
            floorCalories={floorCalories}
            floorNote={floorNote}
            clientName={firstName}
            ageKnown={ageYears != null}
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
            <PhaseOfRecordCard
              athleteId={athleteId}
              groupId={groupId}
              coachId={coachId}
              clientName={firstName}
              plan={phasePlan}
              derived={derivedPhase && derivedPhase.source !== "plan" ? { phase: derivedPhase.phase, source: derivedPhase.source } : null}
              todayKey={todayKey}
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
                defaultPhase={phasePlan?.phase ?? derivedPhase?.phase ?? milestoneTagToNutritionPhase(phaseTag)}
                todayKey={todayKey}
                floorCalories={floorCalories}
                floorNote={floorNote}
                clientName={firstName}
                proteinGPerLb={prefs.proteinGPerLb}
                defaultDietaryRestrictions={rulesText}
                weightUnit={bodyProfile.weightUnit}
                ageYears={ageYears}
              />
            </div>
          </details>
        </div>
      </section>

      <section>
        <SectionHeading id="preferences" title="Preferences" />
        {answers.length > 0 && (
          <div className="mb-4">
            <ClientAnswersPanel
              athleteId={athleteId}
              clientName={firstName}
              answers={answers}
              variety={prefs.variety}
              currentTarget={scaleTarget}
              todayKey={todayKey}
              metric={bodyProfile.weightUnit === "kg"}
            />
          </div>
        )}
        <PreferencesSection
          athleteId={athleteId}
          initial={prefs}
          weightLbs={weightLogs?.[0]?.weight ?? null}
          updatedByName={updatedByName}
          updatedAtLabel={prefs.updatedAt ? shortDateLabel(prefs.updatedAt.slice(0, 10)) : null}
          clientName={firstName}
          checkinRestrictions={lastCheckinRow?.dietary_restrictions?.trim() || null}
        />
      </section>

      <section>
        <SectionHeading id="meal-plan" title="Meal plan" note="Work out a target with the calculator if you need one, then build the plan from it." />
        {flaggedAssigned.length > 0 && (
          <div role="status" className="mb-4 border border-amber-400/40 bg-amber-400/5 p-3 space-y-1.5">
            <p className="font-body text-sm text-amber-400 font-medium">
              {firstName}&apos;s food preferences conflict with {flaggedAssigned.length === 1 ? "an assigned day" : `${flaggedAssigned.length} assigned days`}. They don&apos;t see the flagged options; build a new plan for these days.
            </p>
            {flaggedAssigned.slice(0, 4).map((d) => (
              <p key={d.date} className="font-body text-xs text-chalk">
                <span className="text-steel">{shortDateLabel(d.date)}:</span> {d.flagged.slice(0, 2).map(describeFlagged).join("; ")}
                {d.flagged.length > 2 ? ` (and ${d.flagged.length - 2} more)` : ""}
              </p>
            ))}
            {flaggedAssigned.length > 4 && <p className="font-body text-xs text-steel">…and {flaggedAssigned.length - 4} more days.</p>}
          </div>
        )}
        <NutritionTools
          athleteId={athleteId}
          groupId={groupId}
          date={todayKey}
          latestBodyWeight={weightLogs?.[0]?.weight ?? null}
          weightTrend={weightTrend}
          existingPlan={existingPlan ?? null}
          defaultAdherenceDays={defaultAdherenceDays}
          defaultRecoveryRating={defaultRecoveryRating}
          defaultDietaryRestrictions={rulesText || (lastCheckin?.dietaryRestrictions ?? null)}
          isInjured={isInjured}
          maintenanceCalories={maintenanceCalories}
          injurySurplusPct={injurySurplusPct}
          initialConsecutiveSurplusSpikes={lastCheckin?.consecutiveSurplusSpikes ?? 0}
          defaultPhase={milestoneTagToNutritionPhase(phaseTag)}
          proteinGPerLb={prefs.proteinGPerLb}
          foodRules={foodRules}
          rulesReadable={!prefsReadError}
          weightUnit={bodyProfile.weightUnit}
          initialActivity={bodyProfile.activity}
          clientName={clientName}
        />
        <div className="mt-8">
          <h3 id="grocery-list" className="font-display font-bold text-lg uppercase leading-none mb-2 scroll-mt-24">Grocery list</h3>
          <GroceryListSection athleteId={athleteId} todayKey={todayKey} clientName={firstName} metric={bodyProfile.weightUnit === "kg"} />
        </div>
      </section>

      <section>
        <SectionHeading id="what-they-ate" title="What they ate" note="The last 7 days of their food log against their target." />
        <WhatTheyAte week={week} weightTrend={weightTrend} clientName={firstName} weightUnit={bodyProfile.weightUnit} />
      </section>

      <section>
        <SectionHeading id="nutrients" title="Nutrients" note="Vitamins and minerals from the foods they logged, against their reference intake." />
        <NutrientsSection
          athleteId={athleteId}
          todayKey={todayKey}
          audience="coach"
          clientName={firstName}
          detailHref={(key) => `/groups/${groupId}/nutrition/nutrients/${key}?athleteId=${athleteId}`}
        />
      </section>
    </div>
  );
}
