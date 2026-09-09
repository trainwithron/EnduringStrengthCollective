"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { createBrowserClient } from "@/lib/supabase/client";
import {
  computeCheckIn,
  computeCarbCyclingTargets,
  matchFlexTreat,
  generateFullMealPlan,
  detectDietArchetype,
  QUICK_SWAP_NOTES,
  type Phase,
  type MacroTargets,
  type GeneratedMeal,
  type MealOption,
  type Recipe,
} from "@/lib/meal-engine";
import { fetchCustomRecipes } from "@/lib/custom-recipes";
import {
  getDatesForWeekdays,
  mergeMealIntoPlan,
  type MealEntryPayload,
  type MealPlanRow,
  type MealRecipeChoice,
} from "@/lib/meal-plan-assignment";
import type { WeeklyWeightTrend } from "@/lib/weight-trend";
import { RecipeVoteFavorite } from "./recipe-vote-favorite";

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
}: {
  athleteId: string;
  groupId: string;
  date: string;
  latestBodyWeight: number | null;
  weightTrend?: WeeklyWeightTrend | null;
  existingPlan: SavedPlanShape | null;
  importedMacros?: ImportedMacros | null;
}) {
  const router = useRouter();
  const resultsRef = useRef<HTMLDivElement>(null);

  // Real logged weights fill these in when available — this week's avg
  // for "current," last week's avg for "previous" — so the coach isn't
  // retyping numbers already sitting in body_weight_logs. Falls back to
  // the single latest log, then blank, when there isn't enough history.
  const [phase, setPhase] = useState<Phase>("fat_loss");
  const [currentWeight, setCurrentWeight] = useState(
    (weightTrend?.currentAvg ?? latestBodyWeight)?.toString() ?? ""
  );
  const [previousWeight, setPreviousWeight] = useState(weightTrend?.previousAvg?.toString() ?? "");
  const [currentCalories, setCurrentCalories] = useState("");
  const [adherenceDays, setAdherenceDays] = useState("7");
  const [rateStrength, setRateStrength] = useState("4");
  const [rateRecovery, setRateRecovery] = useState("4");
  const [rateDigestion, setRateDigestion] = useState("5");
  const [rateSatiety, setRateSatiety] = useState("4");
  const [mealCount, setMealCount] = useState("4");
  const [includeSnack, setIncludeSnack] = useState(true);
  const [dietaryRestrictions, setDietaryRestrictions] = useState("");
  const [favoriteFoods, setFavoriteFoods] = useState("");
  const [carbCycling, setCarbCycling] = useState(false);
  const [trainingDays, setTrainingDays] = useState("4");

  // Results
  const [rationale, setRationale] = useState("");
  const [archetype, setArchetype] = useState("");
  const [dailyMacros, setDailyMacros] = useState<MacroTargets | null>(null);
  const [trainMacros, setTrainMacros] = useState<MacroTargets | null>(null);
  const [restMacros, setRestMacros] = useState<MacroTargets | null>(null);
  const [dayView, setDayView] = useState<DayView>("daily");
  const [mealsByView, setMealsByView] = useState<Record<DayView, GeneratedMeal[]>>({ daily: [], train: [], rest: [] });
  // Which option indices are checked per meal slot — a slot can have
  // several recipes selected at once (e.g. two breakfast options a
  // client can alternate between), not just one.
  const [selections, setSelections] = useState<Record<string, number[]>>({});
  const [flexTreatText, setFlexTreatText] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // "Suggest with AI" — one extra option per meal slot from the AI meal
  // planner, additive alongside the deterministic engine's own options.
  const [aiSuggesting, setAiSuggesting] = useState<Record<string, boolean>>({});
  const [aiError, setAiError] = useState<Record<string, string | null>>({});

  // Per-meal-slot "assign this recipe to specific days this week" picker
  // — independent of the full-day Save button below.
  const [dayPicker, setDayPicker] = useState<Record<string, number[]>>({});
  const [assigning, setAssigning] = useState<string | null>(null);
  const [assignedMsg, setAssignedMsg] = useState<Record<string, string>>({});

  // Recipe Hub v2 — this coach's own submitted recipes, pooled alongside
  // the built-in RECIPE_DATABASE every time a plan generates. Fetched once
  // on mount since the coach viewing this page is always the one whose
  // recipes should appear (this page is coach-gated one level up).
  const [customRecipes, setCustomRecipes] = useState<Recipe[]>([]);
  useEffect(() => {
    let cancelled = false;
    async function run() {
      const supabase = createBrowserClient();
      const {
        data: { user },
      } = await supabase.auth.getUser();
      if (!user || cancelled) return;
      const recipes = await fetchCustomRecipes(user.id);
      if (!cancelled) setCustomRecipes(recipes);
    }
    run();
    return () => {
      cancelled = true;
    };
  }, []);

  function handleGenerate() {
    setError(null);
    const currW = parseFloat(currentWeight) || 0;
    const currC = parseInt(currentCalories, 10) || 0;
    if (!currW || !currC) {
      setError("Enter both current weight and current daily calories.");
      return;
    }

    const result = computeCheckIn({
      phase,
      currentWeight: currW,
      previousWeight: parseFloat(previousWeight) || currW,
      currentCalories: currC,
      adherenceDays: parseInt(adherenceDays, 10) || 7,
      rateStrength: parseInt(rateStrength, 10) || 4,
      rateRecovery: parseInt(rateRecovery, 10) || 4,
      rateDigestion: parseInt(rateDigestion, 10) || 5,
      rateSatiety: parseInt(rateSatiety, 10) || 4,
      dietaryRestrictions,
    });

    setRationale(result.rationale);
    setArchetype(result.archetype);
    setDailyMacros(result.dailyBaseline);

    const context = {
      archetype: result.archetype,
      bioScores: {
        strength: parseInt(rateStrength, 10) || 4,
        recovery: parseInt(rateRecovery, 10) || 4,
        digestion: parseInt(rateDigestion, 10) || 5,
        satiety: parseInt(rateSatiety, 10) || 4,
      },
      phase,
      dietaryRestrictions,
      favoriteFoods,
    };

    const nMeals = parseInt(mealCount, 10) || 4;
    const isCycling = carbCycling && result.archetype !== "carnivore";

    if (isCycling) {
      const { trainingDay, restDay } = computeCarbCyclingTargets(result.dailyBaseline, parseInt(trainingDays, 10) || 4);
      setTrainMacros(trainingDay);
      setRestMacros(restDay);
      setMealsByView({
        daily: [],
        train: generateFullMealPlan(trainingDay, nMeals, includeSnack, context, customRecipes),
        rest: generateFullMealPlan(restDay, nMeals, includeSnack, context, customRecipes),
      });
      setDayView("train");
    } else {
      setTrainMacros(null);
      setRestMacros(null);
      setMealsByView({ daily: generateFullMealPlan(result.dailyBaseline, nMeals, includeSnack, context, customRecipes), train: [], rest: [] });
      setDayView("daily");
    }

    const flex = matchFlexTreat(favoriteFoods, result.archetype);
    setFlexTreatText(
      flex
        ? `Requested ${flex.treat.name} (~${flex.treat.cals} kcal). Weekly buffer: trim ~${flex.dailyTrimCalories} kcal/day on the other 6 days. Same-day swap: drop ${flex.sameDayCarbDrop}g carbs and ${flex.sameDayFatDrop}g fat that day instead, keeping protein locked in.`
        : null
    );
    setSelections({});
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

    const context = {
      archetype: arch,
      bioScores: {
        strength: parseInt(rateStrength, 10) || 4,
        recovery: parseInt(rateRecovery, 10) || 4,
        digestion: parseInt(rateDigestion, 10) || 5,
        satiety: parseInt(rateSatiety, 10) || 4,
      },
      phase,
      dietaryRestrictions,
      favoriteFoods,
    };
    const nMeals = parseInt(mealCount, 10) || 4;
    setMealsByView({ daily: generateFullMealPlan(macros, nMeals, includeSnack, context, customRecipes), train: [], rest: [] });

    const flex = matchFlexTreat(favoriteFoods, arch);
    setFlexTreatText(
      flex
        ? `Requested ${flex.treat.name} (~${flex.treat.cals} kcal). Weekly buffer: trim ~${flex.dailyTrimCalories} kcal/day on the other 6 days. Same-day swap: drop ${flex.sameDayCarbDrop}g carbs and ${flex.sameDayFatDrop}g fat that day instead, keeping protein locked in.`
        : null
    );
    setSelections({});
    setError(null);
    resultsRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [importedMacros?.key]);

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
        const recipes: MealRecipeChoice[] = selIdxs
          .map((idx) => m.options[idx])
          .filter((opt): opt is NonNullable<typeof opt> => !!opt)
          .map((opt) => ({
            recipeId: opt.recipeId ?? null,
            recipeName: opt.recipeName ?? null,
            ingredients: opt.ingredients ?? [],
            isAi: opt.isAi,
          }));
        return {
          mealId: m.spec.id,
          title: m.spec.title,
          proteinTarget: m.spec.proteinTarget,
          carbsTarget: m.spec.carbsTarget,
          fatTarget: m.spec.fatTarget,
          recipes,
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
    const chosenRecipes: MealRecipeChoice[] = selIdxs
      .map((idx) => meal.options[idx])
      .filter((opt): opt is NonNullable<typeof opt> => !!opt)
      .map((opt) => ({
        recipeId: opt.recipeId ?? null,
        recipeName: opt.recipeName ?? null,
        ingredients: opt.ingredients ?? [],
        isAi: opt.isAi,
      }));
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

  async function handleAiSuggest(meal: GeneratedMeal) {
    if (aiSuggesting[meal.spec.id]) return;
    setAiSuggesting((prev) => ({ ...prev, [meal.spec.id]: true }));
    setAiError((prev) => ({ ...prev, [meal.spec.id]: null }));

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
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Couldn't get an AI suggestion.");

      const newOption: MealOption = {
        recipeId: `ai-${Date.now()}`,
        recipeName: data.recipeName,
        ingredients: data.ingredients,
        isAi: true,
      };
      setMealsByView((prev) => {
        const updated = prev[dayView].map((m) =>
          m.spec.id === meal.spec.id ? { ...m, options: [...m.options, newOption] } : m
        );
        return { ...prev, [dayView]: updated };
      });
      setSelections((prev) => ({
        ...prev,
        [meal.spec.id]: [...(prev[meal.spec.id] ?? []), meal.options.length],
      }));
    } catch (err) {
      setAiError((prev) => ({
        ...prev,
        [meal.spec.id]: err instanceof Error ? err.message : "Couldn't get an AI suggestion.",
      }));
    } finally {
      setAiSuggesting((prev) => ({ ...prev, [meal.spec.id]: false }));
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
          <span className="font-body text-[11px] text-steel uppercase tracking-wide">Phase</span>
          <select
            value={phase}
            onChange={(e) => setPhase(e.target.value as Phase)}
            className="w-full h-9 bg-graphite border border-steel/30 text-chalk px-2 font-body text-sm mt-1"
          >
            <option value="fat_loss">Fat Loss / Deficit</option>
            <option value="maintenance">Maintenance</option>
            <option value="hypertrophy">Muscle Gain / Surplus</option>
          </select>
        </label>
        <label className="block">
          <span className="font-body text-[11px] text-steel uppercase tracking-wide">Meal frequency</span>
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
          <span className="font-body text-[11px] text-steel uppercase tracking-wide">Current avg weight (lbs)</span>
          <input
            type="number"
            value={currentWeight}
            onChange={(e) => setCurrentWeight(e.target.value)}
            className="w-full h-9 bg-graphite border border-steel/30 text-chalk px-2 font-body text-sm mt-1"
          />
        </label>
        <label className="block">
          <span className="font-body text-[11px] text-steel uppercase tracking-wide">Previous avg weight (lbs)</span>
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
          <span className="font-body text-[11px] text-steel uppercase tracking-wide">
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
          <span className="font-body text-[11px] text-steel uppercase tracking-wide">Adherence (days/7)</span>
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
          <span className="font-body text-[10px] text-steel uppercase tracking-wide">Strength 1-5</span>
          <input type="number" min={1} max={5} value={rateStrength} onChange={(e) => setRateStrength(e.target.value)} className="w-full h-8 bg-graphite border border-steel/30 text-chalk px-2 font-body text-xs mt-1" />
        </label>
        <label className="block">
          <span className="font-body text-[10px] text-steel uppercase tracking-wide">Recovery 1-5</span>
          <input type="number" min={1} max={5} value={rateRecovery} onChange={(e) => setRateRecovery(e.target.value)} className="w-full h-8 bg-graphite border border-steel/30 text-chalk px-2 font-body text-xs mt-1" />
        </label>
        <label className="block">
          <span className="font-body text-[10px] text-steel uppercase tracking-wide">Digestion 1-5</span>
          <input type="number" min={1} max={5} value={rateDigestion} onChange={(e) => setRateDigestion(e.target.value)} className="w-full h-8 bg-graphite border border-steel/30 text-chalk px-2 font-body text-xs mt-1" />
        </label>
        <label className="block">
          <span className="font-body text-[10px] text-steel uppercase tracking-wide">Satiety 1-5</span>
          <input type="number" min={1} max={5} value={rateSatiety} onChange={(e) => setRateSatiety(e.target.value)} className="w-full h-8 bg-graphite border border-steel/30 text-chalk px-2 font-body text-xs mt-1" />
        </label>
      </div>

      <label className="block">
        <span className="font-body text-[11px] text-steel uppercase tracking-wide">Dietary restrictions / diet type / disliked foods</span>
        <input
          type="text"
          value={dietaryRestrictions}
          onChange={(e) => setDietaryRestrictions(e.target.value)}
          placeholder="e.g. Vegan, Keto, No eggs"
          className="w-full h-9 bg-graphite border border-steel/30 text-chalk px-2 font-body text-sm mt-1"
        />
      </label>

      <label className="block">
        <span className="font-body text-[11px] text-steel uppercase tracking-wide">Favorite foods / specific requests</span>
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
              <p className="font-body text-[10px] text-steel uppercase">Calories</p>
            </div>
            <div className="border border-steel/20 p-2">
              <p className="font-display text-lg">{macros.protein}g</p>
              <p className="font-body text-[10px] text-steel uppercase">Protein</p>
            </div>
            <div className="border border-steel/20 p-2">
              <p className="font-display text-lg">{macros.carbs}g</p>
              <p className="font-body text-[10px] text-steel uppercase">Carbs</p>
            </div>
            <div className="border border-steel/20 p-2">
              <p className="font-display text-lg">{macros.fats}g</p>
              <p className="font-body text-[10px] text-steel uppercase">Fat</p>
            </div>
          </div>

          <div className="space-y-3">
            {meals.map((meal) => {
              const selIdxs = selections[meal.spec.id] ?? [];
              return (
                <div key={meal.spec.id} className="border border-steel/20 p-3">
                  <div className="flex items-center justify-between mb-2">
                    <span className="font-body font-medium text-sm">{meal.spec.title}</span>
                    <span className="font-body text-xs text-steel">
                      {meal.spec.proteinTarget}g P · {meal.spec.carbsTarget}g C · {meal.spec.fatTarget}g F
                    </span>
                  </div>
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
                            <span className="font-body text-[9px] uppercase tracking-wide text-rust border border-rust/40 px-1.5 py-0.5">
                              AI
                            </span>
                          )}
                          <RecipeVoteFavorite recipeId={opt.recipeId} />
                        </div>
                        <ul className="space-y-0.5 pl-6">
                          {opt.isAi
                            ? opt.ingredients.map((ing, i) => (
                                // AI-generated text, not the fixed recipe database —
                                // rendered as plain text, never dangerouslySetInnerHTML.
                                <li key={i} className="font-body text-xs text-steel">
                                  • {ing}
                                </li>
                              ))
                            : opt.ingredients.map((ing, i) => (
                                // Ingredient lines carry <strong> tags from the
                                // recipe database itself (fixed, coach-owned
                                // content, not user input) — same as the source
                                // tool's rendering.
                                <li
                                  key={i}
                                  className="font-body text-xs text-steel"
                                  dangerouslySetInnerHTML={{ __html: `• ${ing}` }}
                                />
                              ))}
                        </ul>
                      </label>
                      );
                    })}
                  </div>

                  <div className="mt-2 flex items-center gap-2">
                    <button
                      type="button"
                      onClick={() => handleAiSuggest(meal)}
                      disabled={aiSuggesting[meal.spec.id]}
                      className="h-7 px-3 font-body text-[11px] border border-rust/40 text-rust disabled:opacity-40"
                    >
                      {aiSuggesting[meal.spec.id] ? "Asking AI…" : "Suggest with AI"}
                    </button>
                    {aiError[meal.spec.id] && (
                      <p className="font-body text-[10px] text-rust" role="alert">
                        {aiError[meal.spec.id]}
                      </p>
                    )}
                  </div>

                  <div className="mt-2.5 pt-2.5 border-t border-steel/10">
                    <p className="font-body text-[10px] text-steel uppercase tracking-wide mb-1.5">
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
                            className={`w-7 h-7 font-body text-[10px] border ${
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
                        className="h-7 px-3 font-body text-[10px] bg-positive text-graphite disabled:opacity-40"
                      >
                        {assigning === meal.spec.id ? "Assigning…" : "Assign"}
                      </button>
                    </div>
                    {assignedMsg[meal.spec.id] && (
                      <p className="font-body text-[10px] text-positive mt-1">{assignedMsg[meal.spec.id]}</p>
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
