"use client";

import { IngredientLine } from "@/components/shared/ingredient-line";
import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { createBrowserClient } from "@/lib/supabase/client";
import {
  computeCarbCyclingTargets,
  matchFlexTreat,
  detectDietArchetype,
  QUICK_SWAP_NOTES,
  type Phase,
  type MacroTargets,
  type GeneratedMeal,
  type MealOption,
} from "@/lib/meal-engine";
import { runCheckInEngine } from "@/lib/nutrition-checkin";
import { computeArchetypeMacros, detectDietArchetype as detectMacroArchetype } from "@/lib/macros";
import { filterOptionsByRules } from "@/lib/plan-preference-check";
import type { FoodRules } from "@/lib/allergen-check";
import { loadLibraryContext, type LibraryContextData } from "@/lib/library-data";
import { varietySettings, selectOptions, type SelectionContext } from "@/lib/library-selection";
import { choiceFromOption, generateLibraryDay, generateLibraryWeek, optionFromScaled } from "@/lib/library-meal-plan";
import { buildAiRecipeRows } from "@/lib/ai-recipe-save";
import { DIET_TYPES, type DietType, type Slot } from "@/lib/meal-templates/types";
import { specTarget } from "@/lib/library-meal-plan";
import {
  getDatesForWeekdays,
  getWeekDates,
  mergeMealIntoPlan,
  type MealEntryPayload,
  type MealPlanRow,
  type MealRecipeChoice,
} from "@/lib/meal-plan-assignment";
import type { WeeklyWeightTrend } from "@/lib/weight-trend";
import { RecipeVoteFavorite } from "./recipe-vote-favorite";
import { AiOutputWrongButton } from "@/components/coach/ai-output-wrong-button";
import { AiUsageMeter } from "@/components/coach/ai-usage-meter";

type DayView = "daily" | "train" | "rest";

const WEEKDAY_LABELS = ["Su", "Mo", "Tu", "We", "Th", "Fr", "Sa"];

interface SavedPlanShape {
  archetype: string;
  meal_count: number;
  include_snack: boolean;
  carb_cycling: boolean;
  rationale: string | null;
  macros: Record<string, unknown>;
  meals: Record<string, unknown>;
}

export interface ImportedMacros {
  calories: number;
  protein: number;
  carbs: number;
  fats: number;
  // A change in this value (not the numbers themselves — the coach may
  // re-import the exact same macros twice in a row) is what re-triggers
  // the import effect below.
  key: number;
}

export function MealPlanGenerator({
  athleteId,
  groupId,
  date,
  latestBodyWeight,
  weightTrend,
  existingPlan,
  importedMacros,
  defaultAdherenceDays,
  defaultRecoveryRating,
  defaultDietaryRestrictions,
  isInjured,
  maintenanceCalories,
  injurySurplusPct,
  initialConsecutiveSurplusSpikes,
  initialPhase,
  proteinGPerLb,
  foodRules,
}: {
  athleteId: string;
  groupId: string;
  date: string;
  latestBodyWeight: number | null;
  weightTrend?: WeeklyWeightTrend | null;
  existingPlan: SavedPlanShape | null;
  importedMacros?: ImportedMacros | null;
  // Real data, computed the same way WeeklyCheckinPanel's own identical
  // props are (defaultRecoveryRating from wellness_checkins,
  // defaultAdherenceDays from food_log_entries, isInjured/maintenanceCalories/
  // injurySurplusPct from athlete_injury_status) — all optional so a
  // caller that doesn't pass them yet sees the same manual-entry
  // defaults this form already had.
  defaultAdherenceDays?: number | null;
  defaultRecoveryRating?: number | null;
  defaultDietaryRestrictions?: string | null;
  isInjured?: boolean;
  maintenanceCalories?: number | null;
  injurySurplusPct?: number;
  initialConsecutiveSurplusSpikes?: number;
  // This client's real tagged phase (mapped via milestoneTagToNutritionPhase),
  // when one is in view — falls back to "fat_loss" otherwise, same as
  // before this existed.
  initialPhase?: Phase | null;
  // This client's own protein target in g per pound (their preferences); without it the platform's 1 g per pound.
  proteinGPerLb?: number;
  // This client's allergies, intolerances, dislikes and diet. An option that breaks any of them is never offered, whatever its source.
  foodRules?: FoodRules;
}) {
  const router = useRouter();
  const resultsRef = useRef<HTMLDivElement>(null);

  // Real logged weights fill these in when available — this week's avg
  // for "current," last week's avg for "previous" — so the coach isn't
  // retyping numbers already sitting in body_weight_logs. Falls back to
  // the single latest log, then blank, when there isn't enough history.
  const [phase, setPhase] = useState<Phase>(initialPhase ?? "fat_loss");
  const [currentWeight, setCurrentWeight] = useState(
    (weightTrend?.currentAvg ?? latestBodyWeight)?.toString() ?? ""
  );
  const [previousWeight, setPreviousWeight] = useState(weightTrend?.previousAvg?.toString() ?? "");
  const [currentCalories, setCurrentCalories] = useState("");
  const [adherenceDays, setAdherenceDays] = useState(
    defaultAdherenceDays != null ? String(defaultAdherenceDays) : "7"
  );
  const [rateStrength, setRateStrength] = useState("4");
  const [rateRecovery, setRateRecovery] = useState(
    defaultRecoveryRating != null ? String(defaultRecoveryRating) : "4"
  );
  const [rateDigestion, setRateDigestion] = useState("5");
  const [rateSatiety, setRateSatiety] = useState("4");
  const [mealCount, setMealCount] = useState("4");
  const [includeSnack, setIncludeSnack] = useState(true);
  const [dietaryRestrictions, setDietaryRestrictions] = useState(defaultDietaryRestrictions ?? "");
  const [favoriteFoods, setFavoriteFoods] = useState("");
  const [carbCycling, setCarbCycling] = useState(false);
  const [trainingDays, setTrainingDays] = useState("4");
  // Hypertrophy-phase running state, carried forward across repeated
  // runs in this same session — same field runCheckInEngine already
  // threads through nutrition_checkins via WeeklyCheckinPanel.
  const [consecutiveSurplusSpikes, setConsecutiveSurplusSpikes] = useState(
    initialConsecutiveSurplusSpikes ?? 0
  );

  // Results
  const [rationale, setRationale] = useState("");
  const [archetype, setArchetype] = useState("");
  const [dailyMacros, setDailyMacros] = useState<MacroTargets | null>(null);
  const [trainMacros, setTrainMacros] = useState<MacroTargets | null>(null);
  const [restMacros, setRestMacros] = useState<MacroTargets | null>(null);
  const [dayView, setDayView] = useState<DayView>("daily");
  const [mealsByView, setMealsByView] = useState<Record<DayView, GeneratedMeal[]>>({ daily: [], train: [], rest: [] });
  // Options left out because they break this client's food rules (an allergy is never offered), counted so the coach is told rather than left to wonder.
  const [leftOutForRules, setLeftOutForRules] = useState(0);
  // Which option indices are checked per meal slot — a slot can have
  // several recipes selected at once (e.g. two breakfast options a
  // client can alternate between), not just one.
  const [selections, setSelections] = useState<Record<string, number[]>>({});
  const [flexTreatText, setFlexTreatText] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // "The Nutrition Spot" (nutrition_spot_revamp_scoping_sept19.md) — up
  // to 3 real, verified AI-generated options per meal slot, additive
  // alongside the deterministic engine's own options. Automatically
  // falls back to the deterministic engine (clearly labeled) whenever
  // AI is unavailable.
  const [aiSuggesting, setAiSuggesting] = useState<Record<string, boolean>>({});
  const [aiError, setAiError] = useState<Record<string, string | null>>({});
  const [aiSuggestingAll, setAiSuggestingAll] = useState(false);
  const [aiSuggestAllError, setAiSuggestAllError] = useState<string | null>(null);
  // ai_output_foolproofing_and_quality_assurance_idea.md — ties one
  // "AI Suggest All" charge to its refund (auto, if nothing came back,
  // or coach-flagged afterward). Cleared on a fresh run so a stale
  // reference from an earlier charge is never reused.
  const [lastChargeReferenceId, setLastChargeReferenceId] = useState<string | null>(null);

  // Per-meal-slot "assign this recipe to specific days this week" picker
  // — independent of the full-day Save button below.
  const [dayPicker, setDayPicker] = useState<Record<string, number[]>>({});
  const [assigning, setAssigning] = useState<string | null>(null);
  const [assignedMsg, setAssignedMsg] = useState<Record<string, string>>({});

  // Recipe Hub v2 — this coach's own submitted recipes, pooled alongside
  // the built-in RECIPE_DATABASE every time a plan generates. Fetched once
  // on mount since the coach viewing this page is always the one whose
  // recipes should appear (this page is coach-gated one level up).
  // Library-first (nutrition phase 4b): the coach's own recipes, the foods this client likes, what they have eaten (their favorites) and what they were offered lately, read once
  // when the planner opens. A build before this has loaded is held back, so a menu is never made without the client's history.
  const [libraryData, setLibraryData] = useState<LibraryContextData | null>(null);
  const [coachId, setCoachId] = useState<string | null>(null);
  useEffect(() => {
    let cancelled = false;
    async function run() {
      const supabase = createBrowserClient();
      const {
        data: { user },
      } = await supabase.auth.getUser();
      if (!user || cancelled) return;
      setCoachId(user.id);
      const data = await loadLibraryContext(supabase, { coachId: user.id, athleteId, todayKey: date });
      if (!cancelled) setLibraryData(data);
    }
    run();
    return () => {
      cancelled = true;
    };
  }, [athleteId, date]);

  // The diet the library is filtered by: the client's own diet type when they have one, else what the restrictions text says.
  function libraryDiet(recipeArchetype: string): DietType {
    const own = foodRules?.dietType;
    if (own && (DIET_TYPES as string[]).includes(own)) return own as DietType;
    return (DIET_TYPES as string[]).includes(recipeArchetype) ? (recipeArchetype as DietType) : "omnivore";
  }

  function selectionCtx(recipeArchetype: string, excludeKeys?: Set<string>): SelectionContext {
    const v = varietySettings(libraryData?.variety);
    return {
      rules: foodRules ?? {},
      diet: libraryDiet(recipeArchetype),
      likes: libraryData?.likes ?? [],
      favorites: { ids: new Set(libraryData?.favorites.ids ?? []), names: new Set(libraryData?.favorites.names ?? []) },
      recentlyOffered: libraryData?.recentlyOffered ?? new Map(),
      mixItUp: v.mixItUp,
      recentDays: v.recentDays,
      coachRecipes: libraryData?.coachRecipes ?? [],
      excludeKeys,
    };
  }

  // One day from the library; counts what the client's food rules removed, and checks every option by default (the client picks among what is saved).
  function libraryDay(macros: MacroTargets, nMeals: number, snack: boolean, ctx: SelectionContext): GeneratedMeal[] {
    const meals = generateLibraryDay(macros, nMeals, snack, ctx);
    const removed = meals.reduce((n, m) => n + (m.leftOutForRules ?? 0), 0);
    if (removed > 0) setLeftOutForRules((n) => n + removed);
    return meals;
  }
  // Every option is checked by default: the client sees all of them and picks. (A training-day and a rest-day view share the same meal ids, so the count is the larger of the two.)
  const allOptionsSelected = (...views: GeneratedMeal[][]): Record<string, number[]> => {
    const most = new Map<string, number>();
    for (const meals of views) for (const m of meals) most.set(m.spec.id, Math.max(most.get(m.spec.id) ?? 0, m.options.length));
    return Object.fromEntries([...most].map(([id, n]) => [id, Array.from({ length: n }, (_, i) => i)]));
  };

  function handleGenerate() {
    setError(null);
    if (!libraryData) {
      setError("Still loading this client's history and your recipes. Try again in a moment.");
      return;
    }
    const currW = parseFloat(currentWeight) || 0;
    const currC = parseInt(currentCalories, 10) || 0;
    if (!currW || !currC) {
      setError("Enter both current weight and current daily calories.");
      return;
    }

    const engineResult = runCheckInEngine({
      phase,
      prevWeightLbs: parseFloat(previousWeight) || currW,
      currWeightLbs: currW,
      currentCalories: currC,
      adherenceDays: parseInt(adherenceDays, 10) || 7,
      recoveryRating: parseInt(rateRecovery, 10) || 4,
      consecutiveSurplusSpikes,
      isInjured,
      maintenanceCalories,
      injurySurplusPct,
    });
    setConsecutiveSurplusSpikes(engineResult.consecutiveSurplusSpikes);

    // Two different archetype readings, deliberately kept separate: the
    // 6-way one (meal-engine's own detectDietArchetype) drives recipe/
    // food-suggestion matching below and is what gets saved/displayed as
    // "archetype" — the 3-way one (lib/macros.ts, aliased on import) only
    // ever feeds the macro-split math, matching WeeklyCheckinPanel's own
    // identical split.
    const recipeArchetype = detectDietArchetype(dietaryRestrictions);
    const macroSplit = computeArchetypeMacros(
      engineResult.newCalories,
      currW,
      detectMacroArchetype(dietaryRestrictions),
      proteinGPerLb
    );
    const dailyBaseline: MacroTargets = {
      calories: macroSplit.resolvedCalories,
      protein: macroSplit.proteinG,
      carbs: macroSplit.carbsG,
      fats: macroSplit.fatG,
    };

    setRationale(
      engineResult.rationale +
        (engineResult.injuryOverrideApplied
          ? " [Injury floor applied — calories held up for recovery.]"
          : "")
    );
    setArchetype(recipeArchetype);
    setDailyMacros(dailyBaseline);

    setLeftOutForRules(0);
    const nMeals = parseInt(mealCount, 10) || 4;
    const isCycling = carbCycling && recipeArchetype !== "carnivore";
    const ctx = selectionCtx(recipeArchetype);

    let views: Record<DayView, GeneratedMeal[]>;
    if (isCycling) {
      const { trainingDay, restDay } = computeCarbCyclingTargets(dailyBaseline, parseInt(trainingDays, 10) || 4);
      setTrainMacros(trainingDay);
      setRestMacros(restDay);
      views = { daily: [], train: libraryDay(trainingDay, nMeals, includeSnack, ctx), rest: libraryDay(restDay, nMeals, includeSnack, ctx) };
      setDayView("train");
    } else {
      setTrainMacros(null);
      setRestMacros(null);
      views = { daily: libraryDay(dailyBaseline, nMeals, includeSnack, ctx), train: [], rest: [] };
      setDayView("daily");
    }
    setMealsByView(views);

    const flex = matchFlexTreat(favoriteFoods, recipeArchetype);
    setFlexTreatText(
      flex
        ? `Requested ${flex.treat.name} (~${flex.treat.cals} kcal). Weekly buffer: trim ~${flex.dailyTrimCalories} kcal/day on the other 6 days. Same-day swap: drop ${flex.sameDayCarbDrop}g carbs and ${flex.sameDayFatDrop}g fat that day instead, keeping protein locked in.`
        : null
    );
    setSelections(allOptionsSelected(views.daily, views.train, views.rest));
  }

  // Lets the Macro Calculator hand its numbers straight to this
  // generator — skips the check-in math entirely and builds meal
  // options directly from the imported calories/macros.
  useEffect(() => {
    if (!importedMacros) return;
    const macros: MacroTargets = {
      calories: importedMacros.calories,
      protein: importedMacros.protein,
      carbs: importedMacros.carbs,
      fats: importedMacros.fats,
    };
    const arch = detectDietArchetype(dietaryRestrictions);

    setArchetype(arch);
    setDailyMacros(macros);
    setTrainMacros(null);
    setRestMacros(null);
    setDayView("daily");
    setRationale("Calories & macros imported from the Macro Calculator.");

    // The library's history has to be loaded first; the effect runs again when it is.
    if (!libraryData) return;
    const nMeals = parseInt(mealCount, 10) || 4;
    setLeftOutForRules(0);
    const importedMeals = libraryDay(macros, nMeals, includeSnack, selectionCtx(arch));
    setMealsByView({ daily: importedMeals, train: [], rest: [] });

    const flex = matchFlexTreat(favoriteFoods, arch);
    setFlexTreatText(
      flex
        ? `Requested ${flex.treat.name} (~${flex.treat.cals} kcal). Weekly buffer: trim ~${flex.dailyTrimCalories} kcal/day on the other 6 days. Same-day swap: drop ${flex.sameDayCarbDrop}g carbs and ${flex.sameDayFatDrop}g fat that day instead, keeping protein locked in.`
        : null
    );
    setSelections(allOptionsSelected(importedMeals));
    setError(null);
    resultsRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [importedMacros?.key, libraryData]);

  function activeMacros(): MacroTargets | null {
    if (dayView === "train") return trainMacros;
    if (dayView === "rest") return restMacros;
    return dailyMacros;
  }

  async function handleSave() {
    setSaving(true);
    const supabase = createBrowserClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) {
      setSaving(false);
      return;
    }

    const buildMealsPayload = (meals: GeneratedMeal[]) =>
      meals.map((m) => {
        const selIdxs = selections[m.spec.id]?.length ? selections[m.spec.id] : [0];
        const chosen = selIdxs.map((idx) => ({ idx, opt: m.options[idx] })).filter((x): x is { idx: number; opt: MealOption } => !!x.opt);
        const recipes: MealRecipeChoice[] = chosen.map((x) => choiceFromOption(x.opt));
        // The option the client's card shows first: the one the build featured, if it is among the saved ones.
        const featured = chosen.findIndex((x) => x.idx === (m.featuredIndex ?? 0));
        return {
          mealId: m.spec.id,
          title: m.spec.title,
          proteinTarget: m.spec.proteinTarget,
          carbsTarget: m.spec.carbsTarget,
          fatTarget: m.spec.fatTarget,
          recipes,
          ...(featured > 0 ? { featuredIndex: featured } : {}),
        };
      });

    const isCycling = trainMacros != null && restMacros != null;
    const mealsPayload = isCycling
      ? { train: buildMealsPayload(mealsByView.train), rest: buildMealsPayload(mealsByView.rest) }
      : { daily: buildMealsPayload(mealsByView.daily) };

    await supabase.from("meal_plans").upsert(
      {
        athlete_id: athleteId,
        group_id: groupId,
        log_date: date,
        archetype,
        meal_count: parseInt(mealCount, 10) || 4,
        include_snack: includeSnack,
        carb_cycling: isCycling,
        rationale,
        macros: isCycling ? { train: trainMacros, rest: restMacros } : { daily: dailyMacros },
        meals: mealsPayload,
        created_by: user.id,
      },
      { onConflict: "athlete_id,log_date" }
    );

    setSaving(false);
    router.refresh();
  }

  function toggleDayPicker(mealId: string, weekday: number) {
    setDayPicker((prev) => {
      const current = prev[mealId] ?? [];
      const next = current.includes(weekday)
        ? current.filter((d) => d !== weekday)
        : [...current, weekday].sort((a, b) => a - b);
      return { ...prev, [mealId]: next };
    });
  }

  async function handleAssignDays(meal: GeneratedMeal) {
    const weekdays = dayPicker[meal.spec.id] ?? [];
    const selIdxs = selections[meal.spec.id]?.length ? selections[meal.spec.id] : [0];
    const chosenOptions = selIdxs.map((idx) => ({ idx, opt: meal.options[idx] })).filter((x): x is { idx: number; opt: MealOption } => !!x.opt);
    const chosenRecipes: MealRecipeChoice[] = chosenOptions.map((x) => choiceFromOption(x.opt));
    const assignedFeatured = chosenOptions.findIndex((x) => x.idx === (meal.featuredIndex ?? 0));
    if (weekdays.length === 0 || chosenRecipes.length === 0) return;

    setAssigning(meal.spec.id);
    const supabase = createBrowserClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) {
      setAssigning(null);
      return;
    }

    const targetDates = getDatesForWeekdays(date, weekdays);
    const { data: existingRows } = await supabase
      .from("meal_plans")
      .select("log_date, archetype, meal_count, include_snack, carb_cycling, rationale, macros, meals")
      .eq("athlete_id", athleteId)
      .in("log_date", targetDates);
    const existingByDate = new Map((existingRows ?? []).map((r) => [r.log_date, r as unknown as MealPlanRow]));

    const isCycling = trainMacros != null && restMacros != null;
    const bucket = isCycling ? (dayView as "train" | "rest") : "daily";
    const entry: MealEntryPayload = {
      mealId: meal.spec.id,
      title: meal.spec.title,
      proteinTarget: meal.spec.proteinTarget,
      carbsTarget: meal.spec.carbsTarget,
      fatTarget: meal.spec.fatTarget,
      recipes: chosenRecipes,
      ...(assignedFeatured > 0 ? { featuredIndex: assignedFeatured } : {}),
    };
    const fallbackMacros = isCycling ? { train: trainMacros, rest: restMacros } : { daily: dailyMacros };

    const rows = targetDates.map((targetDate) => {
      const merged = mergeMealIntoPlan(existingByDate.get(targetDate) ?? null, bucket, entry, {
        archetype,
        mealCount: parseInt(mealCount, 10) || 4,
        includeSnack,
        carbCycling: isCycling,
        macros: fallbackMacros,
      });
      return {
        athlete_id: athleteId,
        group_id: groupId,
        log_date: targetDate,
        archetype: merged.archetype,
        meal_count: merged.meal_count,
        include_snack: merged.include_snack,
        carb_cycling: merged.carb_cycling,
        rationale: merged.rationale,
        macros: merged.macros,
        meals: merged.meals,
        created_by: user.id,
      };
    });

    await supabase.from("meal_plans").upsert(rows, { onConflict: "athlete_id,log_date" });

    setAssigning(null);
    setAssignedMsg((prev) => ({
      ...prev,
      [meal.spec.id]: `Assigned ${chosenRecipes.map((r) => `"${r.recipeName}"`).join(", ")} to ${weekdays
        .map((w) => WEEKDAY_LABELS[w])
        .join(", ")}`,
    }));
    setDayPicker((prev) => ({ ...prev, [meal.spec.id]: [] }));
    router.refresh();
  }

  // Builds the whole week (the Sun to Sat week containing this date) from the library in one go: up to three options per meal per day, a featured one for the client's card,
  // meals varied from day to day, the client's favorites repeating, their food rules applied. Replaces what is already planned for those days (after a confirmation).
  const [weekBusy, setWeekBusy] = useState(false);
  const [weekMsg, setWeekMsg] = useState<string | null>(null);
  async function handleBuildWeek() {
    setWeekMsg(null);
    setError(null);
    if (!libraryData) {
      setError("Still loading this client's history and your recipes. Try again in a moment.");
      return;
    }
    if (!dailyMacros || !archetype) {
      setError("Generate a meal plan first, so there are targets to build the week from.");
      return;
    }
    setWeekBusy(true);
    try {
      const supabase = createBrowserClient();
      const {
        data: { user },
      } = await supabase.auth.getUser();
      if (!user) return;
      const dates = getWeekDates(date);
      const nMeals = parseInt(mealCount, 10) || 4;
      const isCycling = trainMacros != null && restMacros != null;
      const ctx = selectionCtx(archetype);
      const rotateFeatured = varietySettings(libraryData.variety).rotateFeatured;
      const build = (macros: MacroTargets) => generateLibraryWeek({ dates, dayMacros: () => macros, mealCount: nMeals, includeSnack, ctx, rotateFeatured });
      const dailyWeek = isCycling ? null : build(dailyMacros);
      const trainWeek = isCycling ? build(trainMacros) : null;
      const restWeek = isCycling ? build(restMacros) : null;

      const { data: existingRows, error: existingError } = await supabase.from("meal_plans").select("log_date").eq("athlete_id", athleteId).in("log_date", dates);
      if (existingError) {
        setError("Couldn't check what is already planned this week, so nothing was changed. Try again.");
        return;
      }
      const existingCount = (existingRows ?? []).length;
      if (existingCount > 0 && !window.confirm(`This replaces the meals already planned for ${existingCount} ${existingCount === 1 ? "day" : "days"} this week. Continue?`)) return;

      const toEntries = (meals: GeneratedMeal[]) =>
        meals.map((m) => ({
          mealId: m.spec.id,
          title: m.spec.title,
          proteinTarget: m.spec.proteinTarget,
          carbsTarget: m.spec.carbsTarget,
          fatTarget: m.spec.fatTarget,
          recipes: m.options.map(choiceFromOption),
          ...((m.featuredIndex ?? 0) > 0 ? { featuredIndex: m.featuredIndex } : {}),
        }));
      const rows = dates.map((d) => ({
        athlete_id: athleteId,
        group_id: groupId,
        log_date: d,
        archetype,
        meal_count: nMeals,
        include_snack: includeSnack,
        carb_cycling: isCycling,
        rationale: "Built from the recipe library for the week.",
        macros: isCycling ? { train: trainMacros, rest: restMacros } : { daily: dailyMacros },
        meals: isCycling ? { train: toEntries(trainWeek![d]), rest: toEntries(restWeek![d]) } : { daily: toEntries(dailyWeek![d]) },
        created_by: user.id,
      }));
      const { error: saveError } = await supabase.from("meal_plans").upsert(rows, { onConflict: "athlete_id,log_date" });
      if (saveError) {
        setError("Couldn't save the week. Nothing was changed. Try again.");
        return;
      }
      const all = [dailyWeek, trainWeek, restWeek].filter((w): w is Record<string, GeneratedMeal[]> => !!w);
      const short = new Map<string, number>();
      for (const w of all) for (const d of dates) for (const m of w[d] ?? []) if ((m.shortfall ?? 0) > 0) short.set(m.spec.title, (short.get(m.spec.title) ?? 0) + 1);
      setWeekMsg(
        short.size === 0
          ? "Built the week: three library options for every meal."
          : `Built the week. Fewer than three library options for: ${[...short].map(([t, n]) => `${t} (${n} ${n === 1 ? "day" : "days"})`).join(", ")}. Use "Ask the Nutrition Spot" on a meal to fill the rest.`
      );
      router.refresh();
    } finally {
      setWeekBusy(false);
    }
  }

  // Saves an approved AI option into this coach's private library (the option was already generated and verified; nothing is asked of the AI here).
  const [libraryMsg, setLibraryMsg] = useState<Record<string, string>>({});
  async function handleSaveToLibrary(meal: GeneratedMeal, opt: MealOption) {
    if (!coachId) return;
    const slot: Slot = meal.spec.slot === "any" ? "lunch" : meal.spec.slot;
    const say = (text: string) => setLibraryMsg((prev) => ({ ...prev, [opt.recipeId]: text }));
    const built = await buildAiRecipeRows(opt, slot);
    if (!built.ok) {
      say(built.reason);
      return;
    }
    const supabase = createBrowserClient();
    const { data: recipe, error } = await supabase
      .from("recipes")
      .insert({ created_by: coachId, ...built.rows.recipe })
      .select("id")
      .single();
    if (error || !recipe) {
      // 23505: the same lines are already saved (the fingerprint is unique per coach).
      say(error?.code === "23505" ? "This meal is already in your library." : "Couldn't save this meal to your library.");
      return;
    }
    const { error: linesError } = await supabase.from("recipe_ingredients").insert(built.rows.ingredients.map((i) => ({ recipe_id: recipe.id, ...i })));
    if (linesError) {
      await supabase.from("recipes").delete().eq("id", recipe.id);
      say("Couldn't save this meal to your library.");
      return;
    }
    say("Saved to your library. It will be offered first from now on.");
  }

  // The Nutrition Spot (nutrition_spot_revamp_scoping_sept19.md) — AI is
  // now the primary suggestion source for a slot: one click returns up
  // to 3 real, verified options (never the AI's own claimed macros —
  // /api/ai/generate-meal-plan discards anything it can't confidently
  // match against real food data before it ever reaches here). The
  // deterministic engine's own options stay untouched and reachable —
  // this only appends alongside them, same additive convention as
  // before — but now serves as the automatic, clearly-labeled fallback
  // whenever AI is unavailable or every option it returned failed
  // verification, rather than a parallel manual choice.
  // Returns whether this call actually delivered a real AI suggestion —
  // used by handleAiSuggestAll to detect "every meal in the batch fell
  // back" so it can auto-refund the flat charge (ai_output_
  // foolproofing_and_quality_assurance_idea.md). The standalone per-meal
  // button already ignores this return value, so it's a pure addition.
  async function handleAiSuggest(meal: GeneratedMeal): Promise<boolean> {
    if (aiSuggesting[meal.spec.id]) return false;
    setAiSuggesting((prev) => ({ ...prev, [meal.spec.id]: true }));
    setAiError((prev) => ({ ...prev, [meal.spec.id]: null }));

    function appendOptions(offered: MealOption[]) {
      // Anything that breaks the client's food rules is dropped here too (the AI route checks as well; the standard-options fallback does not know the rules).
      const newOptions = foodRules ? filterOptionsByRules(offered, foodRules).kept : offered;
      if (newOptions.length < offered.length) setLeftOutForRules((n) => n + offered.length - newOptions.length);
      setMealsByView((prev) => {
        const updated = prev[dayView].map((m) =>
          m.spec.id === meal.spec.id ? { ...m, options: [...m.options, ...newOptions] } : m
        );
        return { ...prev, [dayView]: updated };
      });
      setSelections((prev) => {
        const startIndex = meal.options.length;
        const newIndices = newOptions.map((_, i) => startIndex + i);
        return { ...prev, [meal.spec.id]: [...(prev[meal.spec.id] ?? []), ...newIndices] };
      });
    }

    function runFallback(reason: string) {
      // When the AI is unavailable, more of the library is offered instead: meals already shown for this slot are left out, and the client's food rules still apply.
      const shown = new Set(meal.options.map((o) => o.key).filter((k): k is string => !!k));
      const slot: Slot = meal.spec.slot === "any" ? "lunch" : meal.spec.slot;
      const more = selectOptions(slot, specTarget(meal.spec), selectionCtx(archetype || "omnivore", shown));
      appendOptions(more.options.map((m) => ({ ...optionFromScaled(m), recipeId: `fallback-${Date.now()}-${m.recipeId}`, isFallback: true })));
      setAiError((prev) => ({
        ...prev,
        [meal.spec.id]: more.options.length === 0 ? `${reason} No other library meal fits this slot either.` : reason,
      }));
    }

    try {
      const res = await fetch("/api/ai/generate-meal-plan", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          mealSlot: meal.spec.slot,
          proteinTarget: meal.spec.proteinTarget,
          carbsTarget: meal.spec.carbsTarget,
          fatTarget: meal.spec.fatTarget,
          archetype,
          dietaryRestrictions,
          favoriteFoods,
          // The server reads this client's food rules itself, from the database.
          athleteId,
        }),
      });
      const data = await res.json();

      // Any non-2xx (not configured, rate-limited, a transient API
      // error) is treated as "AI unavailable" for this purpose — the
      // scoping's own list of trigger conditions — never a dead end.
      if (!res.ok) {
        runFallback("AI suggestions unavailable right now — here are some standard options instead.");
        return false;
      }

      const verifiedOptions: {
        recipeName: string;
        ingredients: {
          rawLine: string;
          name?: string | null;
          grams: number | null;
          matchedFdcId?: number | null;
          matchedDescription?: string | null;
          protein?: number | null;
          carbs?: number | null;
          fat?: number | null;
        }[];
        totalProtein: number;
        totalCarbs: number;
        totalFat: number;
        totalKcal: number;
      }[] = data.options ?? [];

      if (verifiedOptions.length === 0) {
        setAiError((prev) => ({
          ...prev,
          [meal.spec.id]:
            (data.droppedForPreferences ?? 0) > 0
              ? "Every suggestion broke this client's food preferences, so none is shown. Try again."
              : "Couldn't verify any of this suggestion's ingredients against real food data — try again.",
        }));
        return false;
      }
      if ((data.droppedForPreferences ?? 0) > 0) setLeftOutForRules((n) => n + (data.droppedForPreferences as number));

      const newOptions: MealOption[] = verifiedOptions.map((o, i) => ({
        recipeId: `ai-${Date.now()}-${i}`,
        recipeName: o.recipeName,
        ingredients: o.ingredients.map((line) => line.rawLine),
        isAi: true,
        verifiedMacros: { protein: o.totalProtein, carbs: o.totalCarbs, fat: o.totalFat, kcal: o.totalKcal },
        source: "ai" as const,
        // Each line's food name (the real food it was matched to) AND the line as written, so the client's food rules are checked against both when the plan is opened.
        lines: o.ingredients.map((line) => ({ name: line.matchedDescription ?? line.name ?? line.rawLine, label: line.rawLine, grams: line.grams })),
        // Kept so the coach can save this option to their library (its lines are matched to real foods).
        aiLines: o.ingredients.map((line) => ({
          rawLine: line.rawLine,
          name: line.matchedDescription ?? line.name ?? null,
          grams: line.grams,
          fdcId: line.matchedFdcId ?? null,
          proteinG: line.protein ?? null,
          carbsG: line.carbs ?? null,
          fatG: line.fat ?? null,
        })),
      }));
      appendOptions(newOptions);
      return true;
    } catch {
      runFallback("AI suggestions unavailable right now — here are some standard options instead.");
      return false;
    } finally {
      setAiSuggesting((prev) => ({ ...prev, [meal.spec.id]: false }));
    }
  }

  // credit_topup_low_tier_monetization_idea.md — nutrition plan
  // generation is priced as ONE 3-credit charge for the whole plan, not
  // per meal slot (the existing per-meal "AI Suggest" above stays free,
  // a personal reroll convenience, not the creditable unit). This hits
  // a single charge endpoint once, then reuses handleAiSuggest's exact
  // per-meal fetch/verify/fallback logic for every slot in the current
  // view — one charge, no duplicated AI-calling logic.
  async function handleAiSuggestAll() {
    const currentMeals = mealsByView[dayView];
    if (aiSuggestingAll || currentMeals.length === 0) return;
    setAiSuggestingAll(true);
    setAiSuggestAllError(null);
    setLastChargeReferenceId(null);
    // One id per charge, generated client-side before the charge even
    // fires — ties this exact charge to its eventual refund (auto or
    // coach-flagged), and the (coach_id, reference_id) uniqueness in
    // refund_coach_credit means this batch can only ever be refunded
    // once however it gets flagged.
    const referenceId = crypto.randomUUID();
    try {
      const res = await fetch("/api/ai/meal-plan-credit-charge", { method: "POST" });
      const data = await res.json();
      if (!res.ok) {
        setAiSuggestAllError(data.error || "Couldn't process credits.");
        return;
      }
      let anySucceeded = false;
      for (const meal of currentMeals) {
        const ok = await handleAiSuggest(meal);
        if (ok) anySucceeded = true;
      }
      if (anySucceeded) {
        // Only offer the manual flag when the batch wasn't already
        // auto-refunded below — no reason to show a redundant "This was
        // wrong" button right next to a message saying it already
        // refunded itself.
        setLastChargeReferenceId(referenceId);
      } else {
        // ai_output_foolproofing_and_quality_assurance_idea.md — the
        // charge already happened but every meal in the batch fell back
        // to non-AI options, meaning nothing was actually delivered for
        // it. Silent, automatic, no coach action needed.
        const refundRes = await fetch("/api/ai/refund-credit", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ action: "nutrition_plan", trigger: "auto_validator_failure", referenceId }),
        }).catch(() => null);
        const refundJson = refundRes?.ok ? await refundRes.json().catch(() => null) : null;
        if (refundJson?.refunded) {
          setAiSuggestAllError("Credit refunded — AI couldn't generate any suggestions right now.");
        }
      }
    } catch {
      setAiSuggestAllError("Couldn't start AI generation — try again.");
    } finally {
      setAiSuggestingAll(false);
    }
  }

  const macros = activeMacros();
  const meals = mealsByView[dayView];

  return (
    <div className="space-y-4">
      {existingPlan && (
        <div className="border border-positive/40 bg-surface/60 p-3">
          <p className="font-body text-xs text-chalk">
            A meal plan is already saved for this day ({existingPlan.meal_count} meals
            {existingPlan.include_snack ? " + snack" : ""}, {existingPlan.archetype}). Generating and saving again
            replaces it.
          </p>
        </div>
      )}

      <div className="grid grid-cols-2 gap-2">
        <label className="block">
          <span className="font-body text-xs text-steel uppercase tracking-wide">Phase</span>
          <select
            value={phase}
            onChange={(e) => setPhase(e.target.value as Phase)}
            className="w-full h-9 bg-graphite border border-steel/30 text-chalk px-2 font-body text-sm mt-1"
          >
            <option value="fat_loss">Fat loss</option>
            <option value="hypertrophy">Muscle building</option>
            <option value="maintenance">Maintenance</option>
            <option value="reverse_diet">Reverse diet</option>
          </select>
        </label>
        <label className="block">
          <span className="font-body text-xs text-steel uppercase tracking-wide">Meal frequency</span>
          <select
            value={mealCount}
            onChange={(e) => setMealCount(e.target.value)}
            className="w-full h-9 bg-graphite border border-steel/30 text-chalk px-2 font-body text-sm mt-1"
          >
            <option value="2">2 meals/day</option>
            <option value="3">3 meals/day</option>
            <option value="4">4 meals/day</option>
            <option value="5">5 meals/day</option>
            <option value="6">6 meals/day</option>
          </select>
        </label>
      </div>

      {weightTrend && (weightTrend.currentCount > 0 || weightTrend.previousCount > 0) && (
        <p className="font-body text-xs text-steel bg-surface/40 p-2.5">
          {weightTrend.currentAvg != null ? (
            <>
              This week: <span className="text-chalk">{weightTrend.currentAvg} lbs</span> avg (
              {weightTrend.currentCount} log{weightTrend.currentCount === 1 ? "" : "s"})
            </>
          ) : (
            "No weigh-ins logged this week yet"
          )}
          {weightTrend.previousAvg != null && (
            <>
              {" "}
              vs <span className="text-chalk">{weightTrend.previousAvg} lbs</span> last week (
              {weightTrend.previousCount} log{weightTrend.previousCount === 1 ? "" : "s"})
            </>
          )}
          {weightTrend.deltaLbs != null && (
            <span
              className={
                weightTrend.deltaLbs > 0.1
                  ? " text-rust"
                  : weightTrend.deltaLbs < -0.1
                  ? " text-positive"
                  : " text-chalk"
              }
            >
              {" "}
              — {weightTrend.deltaLbs > 0.1 ? "↑" : weightTrend.deltaLbs < -0.1 ? "↓" : "→"}{" "}
              {weightTrend.deltaLbs === 0
                ? "maintained"
                : `${Math.abs(weightTrend.deltaLbs)} lbs ${weightTrend.deltaLbs > 0 ? "up" : "down"}`}
            </span>
          )}
          . Fields below are auto-filled from these — adjust by hand if needed.
        </p>
      )}

      <div className="grid grid-cols-2 gap-2">
        <label className="block">
          <span className="font-body text-xs text-steel uppercase tracking-wide">Current avg weight (lbs)</span>
          <input
            type="number"
            value={currentWeight}
            onChange={(e) => setCurrentWeight(e.target.value)}
            className="w-full h-9 bg-graphite border border-steel/30 text-chalk px-2 font-body text-sm mt-1"
          />
        </label>
        <label className="block">
          <span className="font-body text-xs text-steel uppercase tracking-wide">Previous avg weight (lbs)</span>
          <input
            type="number"
            value={previousWeight}
            onChange={(e) => setPreviousWeight(e.target.value)}
            className="w-full h-9 bg-graphite border border-steel/30 text-chalk px-2 font-body text-sm mt-1"
          />
        </label>
      </div>

      <div className="grid grid-cols-2 gap-2">
        <label className="block">
          <span className="font-body text-xs text-steel uppercase tracking-wide">
            Current daily calories{" "}
            <a href="#macro-calculator" className="normal-case text-rust font-normal tracking-normal">
              (don&apos;t know? check here)
            </a>
          </span>
          <input
            type="number"
            value={currentCalories}
            onChange={(e) => setCurrentCalories(e.target.value)}
            className="w-full h-9 bg-graphite border border-steel/30 text-chalk px-2 font-body text-sm mt-1"
          />
        </label>
        <label className="block">
          <span className="font-body text-xs text-steel uppercase tracking-wide">Adherence (days/7)</span>
          <input
            type="number"
            min={0}
            max={7}
            value={adherenceDays}
            onChange={(e) => setAdherenceDays(e.target.value)}
            className="w-full h-9 bg-graphite border border-steel/30 text-chalk px-2 font-body text-sm mt-1"
          />
        </label>
      </div>

      <div className="grid grid-cols-4 gap-2">
        <label className="block">
          <span className="font-body text-xs text-steel uppercase tracking-wide">Strength 1-5</span>
          <input type="number" min={1} max={5} value={rateStrength} onChange={(e) => setRateStrength(e.target.value)} className="w-full h-8 bg-graphite border border-steel/30 text-chalk px-2 font-body text-xs mt-1" />
        </label>
        <label className="block">
          <span className="font-body text-xs text-steel uppercase tracking-wide">Recovery 1-5</span>
          <input type="number" min={1} max={5} value={rateRecovery} onChange={(e) => setRateRecovery(e.target.value)} className="w-full h-8 bg-graphite border border-steel/30 text-chalk px-2 font-body text-xs mt-1" />
        </label>
        <label className="block">
          <span className="font-body text-xs text-steel uppercase tracking-wide">Digestion 1-5</span>
          <input type="number" min={1} max={5} value={rateDigestion} onChange={(e) => setRateDigestion(e.target.value)} className="w-full h-8 bg-graphite border border-steel/30 text-chalk px-2 font-body text-xs mt-1" />
        </label>
        <label className="block">
          <span className="font-body text-xs text-steel uppercase tracking-wide">Satiety 1-5</span>
          <input type="number" min={1} max={5} value={rateSatiety} onChange={(e) => setRateSatiety(e.target.value)} className="w-full h-8 bg-graphite border border-steel/30 text-chalk px-2 font-body text-xs mt-1" />
        </label>
      </div>

      <label className="block">
        <span className="font-body text-xs text-steel uppercase tracking-wide">Dietary restrictions / diet type / disliked foods</span>
        <input
          type="text"
          value={dietaryRestrictions}
          onChange={(e) => setDietaryRestrictions(e.target.value)}
          placeholder="e.g. Vegan, Keto, No eggs"
          className="w-full h-9 bg-graphite border border-steel/30 text-chalk px-2 font-body text-sm mt-1"
        />
      </label>

      <label className="block">
        <span className="font-body text-xs text-steel uppercase tracking-wide">Favorite foods / specific requests</span>
        <input
          type="text"
          value={favoriteFoods}
          onChange={(e) => setFavoriteFoods(e.target.value)}
          placeholder="e.g. Sirloin steak, Sweet potato, Pizza this weekend"
          className="w-full h-9 bg-graphite border border-steel/30 text-chalk px-2 font-body text-sm mt-1"
        />
      </label>

      <div className="flex items-center gap-4">
        <label className="flex items-center gap-2 font-body text-xs text-steel">
          <input type="checkbox" checked={includeSnack} onChange={(e) => setIncludeSnack(e.target.checked)} className="w-4 h-4" />
          Include a daily snack
        </label>
        <label className="flex items-center gap-2 font-body text-xs text-steel">
          <input type="checkbox" checked={carbCycling} onChange={(e) => setCarbCycling(e.target.checked)} className="w-4 h-4" />
          High carb training / low carb rest days
        </label>
        {carbCycling && (
          <select
            value={trainingDays}
            onChange={(e) => setTrainingDays(e.target.value)}
            className="h-8 bg-graphite border border-steel/30 text-chalk px-2 font-body text-xs"
          >
            <option value="3">3 training / 4 rest</option>
            <option value="4">4 training / 3 rest</option>
            <option value="5">5 training / 2 rest</option>
            <option value="6">6 training / 1 rest</option>
          </select>
        )}
      </div>

      {error && (
        <p className="font-body text-xs text-rust" role="alert">
          {error}
        </p>
      )}

      <button
        type="button"
        onClick={handleGenerate}
        className="h-10 px-5 bg-rust text-graphite font-body text-sm font-medium"
      >
        Generate meal plan
      </button>

      {macros && (
        <div ref={resultsRef} className="border-t border-steel/20 pt-4 space-y-4">
          {rationale && <p className="font-body text-sm text-steel bg-surface/40 p-3">{rationale}</p>}
          {leftOutForRules > 0 && (
            <p role="status" className="font-body text-xs text-amber-400 border border-amber-400/40 bg-amber-400/5 p-2.5">
              {leftOutForRules === 1 ? "1 option was" : `${leftOutForRules} options were`} left out because {leftOutForRules === 1 ? "it breaks" : "they break"} this client&apos;s food preferences (an allergy is never offered). Use &ldquo;Ask the Nutrition Spot&rdquo; on a meal for more options.
            </p>
          )}
          {flexTreatText && (
            <p className="font-body text-xs text-chalk bg-rust/10 border border-rust/30 p-3">{flexTreatText}</p>
          )}

          {trainMacros && restMacros && (
            <div className="flex gap-2">
              <button
                type="button"
                onClick={() => setDayView("train")}
                className={`h-8 px-3 font-body text-xs border ${dayView === "train" ? "bg-rust text-graphite border-rust" : "border-steel/30 text-steel"}`}
              >
                Training day
              </button>
              <button
                type="button"
                onClick={() => setDayView("rest")}
                className={`h-8 px-3 font-body text-xs border ${dayView === "rest" ? "bg-rust text-graphite border-rust" : "border-steel/30 text-steel"}`}
              >
                Rest day
              </button>
            </div>
          )}

          <div className="grid grid-cols-4 gap-2 text-center">
            <div className="border border-steel/20 p-2">
              <p className="font-display text-lg">{macros.calories}</p>
              <p className="font-body text-xs text-steel uppercase">Calories</p>
            </div>
            <div className="border border-steel/20 p-2">
              <p className="font-display text-lg">{macros.protein}g</p>
              <p className="font-body text-xs text-steel uppercase">Protein</p>
            </div>
            <div className="border border-steel/20 p-2">
              <p className="font-display text-lg">{macros.carbs}g</p>
              <p className="font-body text-xs text-steel uppercase">Carbs</p>
            </div>
            <div className="border border-steel/20 p-2">
              <p className="font-display text-lg">{macros.fats}g</p>
              <p className="font-body text-xs text-steel uppercase">Fat</p>
            </div>
          </div>

          <div>
            <button
              type="button"
              disabled={aiSuggestingAll || meals.length === 0}
              onClick={handleAiSuggestAll}
              className="h-9 px-4 border border-rust/40 text-rust font-body text-sm disabled:opacity-50"
            >
              {aiSuggestingAll ? "Generating full plan…" : "AI Suggest All — 3 credits"}
            </button>
            <div className="mt-1.5">
              <AiUsageMeter groupId={groupId} focus="mealplan" compact refreshKey={lastChargeReferenceId} />
            </div>
            {aiSuggestAllError && (
              <p className="font-body text-xs text-rust mt-1" role="alert">
                {aiSuggestAllError}
              </p>
            )}
            {lastChargeReferenceId && !aiSuggestingAll && (
              <div className="mt-1.5">
                <AiOutputWrongButton action="nutrition_plan" referenceId={lastChargeReferenceId} />
              </div>
            )}
          </div>

          <div className="border border-steel/20 p-3 space-y-2">
            <p className="font-body text-sm text-chalk">Build the week from the library</p>
            <p className="font-body text-xs text-steel">
              Three options for every meal, every day this week, from Ron&apos;s recipes and your own. Meals change from day to day, this client&apos;s favorites repeat, and their
              food preferences are applied. This replaces what is already planned for the week.
            </p>
            <button
              type="button"
              onClick={handleBuildWeek}
              disabled={weekBusy || meals.length === 0}
              className="h-9 px-4 bg-positive text-graphite font-body text-sm font-medium disabled:opacity-40"
            >
              {weekBusy ? "Building the week…" : "Build the week"}
            </button>
            {weekMsg && (
              <p role="status" className="font-body text-xs text-positive">
                {weekMsg}
              </p>
            )}
          </div>

          <div className="space-y-3">
            {meals.map((meal) => {
              const selIdxs = selections[meal.spec.id] ?? [];
              const libraryCount = meal.options.filter((o) => o.source === "library" || o.source === "coach").length;
              const aiCount = meal.options.filter((o) => o.isAi).length;
              const missing = Math.max(0, 3 - meal.options.length);
              return (
                <div key={meal.spec.id} className="border border-steel/20 p-3">
                  <div className="flex items-center justify-between mb-2">
                    <span className="font-body font-medium text-sm">{meal.spec.title}</span>
                    <span className="font-body text-xs text-steel">
                      {meal.spec.proteinTarget}g P · {meal.spec.carbsTarget}g C · {meal.spec.fatTarget}g F
                    </span>
                  </div>
                  {meal.shortfall !== undefined && (
                    <p className={`font-body text-xs mb-2 ${missing > 0 ? "text-amber-400" : "text-steel"}`}>
                      {libraryCount} from the library
                      {aiCount > 0 ? `, ${aiCount} from the Nutrition Spot` : ""}
                      {missing > 0 ? `, ${missing} to generate` : ""}
                    </p>
                  )}
                  <div className="space-y-2">
                    {meal.options.map((opt, idx) => {
                      const checked = selIdxs.includes(idx);
                      return (
                      <label
                        key={opt.recipeId}
                        className={`block border p-2.5 cursor-pointer ${
                          checked ? "border-positive bg-positive/5" : "border-steel/20 opacity-60"
                        }`}
                        onClick={() =>
                          setSelections((prev) => {
                            const current = prev[meal.spec.id] ?? [];
                            const next = current.includes(idx)
                              ? current.filter((i) => i !== idx)
                              : [...current, idx];
                            return { ...prev, [meal.spec.id]: next };
                          })
                        }
                      >
                        <div className="flex items-center gap-2 mb-1.5">
                          <input type="checkbox" checked={checked} readOnly className="w-4 h-4" />
                          <span className="font-body text-sm font-medium flex-1">{opt.recipeName}</span>
                          {opt.isAi && (
                            <span className="font-body text-xs uppercase tracking-wide text-rust border border-rust/40 px-1.5 py-0.5">
                              Nutrition Spot · verified
                            </span>
                          )}
                          {opt.isFallback && (
                            <span className="font-body text-xs uppercase tracking-wide text-steel border border-steel/40 px-1.5 py-0.5">
                              Standard (AI unavailable)
                            </span>
                          )}
                          <RecipeVoteFavorite recipeId={opt.recipeId} />
                        </div>
                        {opt.macros && (
                          <p className="font-body text-xs text-steel pl-6 mb-1">
                            {opt.source === "coach" ? "Your recipe · " : "Library · "}
                            {opt.macros.calories} kcal — {opt.macros.proteinG}p / {opt.macros.carbsG}c / {opt.macros.fatG}f
                          </p>
                        )}
                        {opt.verifiedMacros && (
                          <p className="font-body text-xs text-steel pl-6 mb-1">
                            Verified: {opt.verifiedMacros.kcal} kcal — {opt.verifiedMacros.protein}p /{" "}
                            {opt.verifiedMacros.carbs}c / {opt.verifiedMacros.fat}f
                          </p>
                        )}
                        <ul className="space-y-0.5 pl-6">
                          {
                            // Always text (only an exact <strong> shows bold), never HTML.
                            opt.ingredients.map((ing, i) => (
                              <li key={i} className="font-body text-xs text-steel">
                                <IngredientLine text={ing} />
                              </li>
                            ))
                          }
                        </ul>
                        {opt.isAi && opt.aiLines && (
                          <div className="pl-6 mt-1.5" onClick={(e) => e.stopPropagation()}>
                            <button
                              type="button"
                              onClick={(e) => {
                                e.preventDefault();
                                handleSaveToLibrary(meal, opt);
                              }}
                              className="h-7 px-3 font-body text-xs border border-steel/40 text-chalk"
                            >
                              Save to my library
                            </button>
                            {libraryMsg[opt.recipeId] && <span className="font-body text-xs text-steel ml-2">{libraryMsg[opt.recipeId]}</span>}
                          </div>
                        )}
                      </label>
                      );
                    })}
                  </div>

                  <div className="mt-2 flex items-center gap-2">
                    <button
                      type="button"
                      onClick={() => handleAiSuggest(meal)}
                      disabled={aiSuggesting[meal.spec.id]}
                      className="h-7 px-3 font-body text-xs border border-rust/40 text-rust disabled:opacity-40"
                    >
                      {aiSuggesting[meal.spec.id] ? "Asking the Nutrition Spot…" : "Ask the Nutrition Spot"}
                    </button>
                    {aiError[meal.spec.id] && (
                      <p className="font-body text-xs text-rust" role="alert">
                        {aiError[meal.spec.id]}
                      </p>
                    )}
                  </div>

                  <div className="mt-2.5 pt-2.5 border-t border-steel/10">
                    <p className="font-body text-xs text-steel uppercase tracking-wide mb-1.5">
                      Assign this meal to specific days this week
                    </p>
                    <div className="flex items-center gap-1 flex-wrap">
                      {WEEKDAY_LABELS.map((label, weekday) => {
                        const active = (dayPicker[meal.spec.id] ?? []).includes(weekday);
                        return (
                          <button
                            key={weekday}
                            type="button"
                            onClick={() => toggleDayPicker(meal.spec.id, weekday)}
                            className={`w-7 h-7 font-body text-xs border ${
                              active ? "bg-rust text-graphite border-rust" : "border-steel/30 text-steel"
                            }`}
                          >
                            {label}
                          </button>
                        );
                      })}
                      <button
                        type="button"
                        onClick={() => handleAssignDays(meal)}
                        disabled={assigning === meal.spec.id || (dayPicker[meal.spec.id] ?? []).length === 0}
                        className="h-7 px-3 font-body text-xs bg-positive text-graphite disabled:opacity-40"
                      >
                        {assigning === meal.spec.id ? "Assigning…" : "Assign"}
                      </button>
                    </div>
                    {assignedMsg[meal.spec.id] && (
                      <p className="font-body text-xs text-positive mt-1">{assignedMsg[meal.spec.id]}</p>
                    )}
                  </div>
                </div>
              );
            })}
          </div>

          <details className="border border-dashed border-steel/30 p-2.5">
            <summary className="font-body text-xs text-rust cursor-pointer">Quick food swaps & conversions</summary>
            <ul className="mt-2 space-y-1">
              {QUICK_SWAP_NOTES.map((note, i) => (
                <li key={i} className="font-body text-xs text-steel">
                  {note}
                </li>
              ))}
            </ul>
          </details>

          <button
            type="button"
            onClick={handleSave}
            disabled={saving}
            className="w-full h-10 bg-positive text-graphite font-body text-sm font-medium disabled:opacity-40"
          >
            {saving ? "Saving…" : "Save meal plan"}
          </button>
        </div>
      )}
    </div>
  );
}
