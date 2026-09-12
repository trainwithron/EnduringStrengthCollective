"use client";

import { useState } from "react";
import { createBrowserClient } from "@/lib/supabase/client";
import {
  runCheckInEngine,
  type NutritionPhase,
  type CheckInResult,
} from "@/lib/nutrition-checkin";
import { computeArchetypeMacros, detectDietArchetype } from "@/lib/macros";

const PHASE_LABELS: Record<NutritionPhase, string> = {
  fat_loss: "Fat loss",
  hypertrophy: "Muscle building",
  maintenance: "Maintenance",
};

function todayIso(): string {
  return new Date().toISOString().slice(0, 10);
}

// Coach-facing action that runs Ron's own weekly calorie-periodization
// rules (lib/nutrition-checkin.ts, ported from his standalone check-in
// tool) against a specific client's real data instead of manually
// re-entering it: this week's/last week's average weight comes from
// body_weight_logs (weightTrend), a default recovery rating from the
// week's average wellness check-ins. Adherence stays a manual 1-7 entry
// — there's no per-meal food logging in this app to derive it from,
// same as the source tool always assumed.
export function WeeklyCheckinPanel({
  athleteId,
  groupId,
  weekAvgWeight,
  lastWeekAvgWeight,
  defaultCurrentCalories,
  defaultRecoveryRating,
  lastCheckin,
}: {
  athleteId: string;
  groupId: string;
  weekAvgWeight: number | null;
  lastWeekAvgWeight: number | null;
  defaultCurrentCalories: number | null;
  defaultRecoveryRating: number | null;
  lastCheckin: {
    phase: NutritionPhase;
    consecutiveSurplusSpikes: number;
    dietaryRestrictions: string;
  } | null;
}) {
  const [phase, setPhase] = useState<NutritionPhase>(lastCheckin?.phase ?? "fat_loss");
  const [prevWeight, setPrevWeight] = useState(
    lastWeekAvgWeight != null ? String(lastWeekAvgWeight) : ""
  );
  const [currWeight, setCurrWeight] = useState(weekAvgWeight != null ? String(weekAvgWeight) : "");
  const [currentCalories, setCurrentCalories] = useState(
    defaultCurrentCalories != null ? String(defaultCurrentCalories) : ""
  );
  const [adherenceDays, setAdherenceDays] = useState("7");
  const [recoveryRating, setRecoveryRating] = useState(
    defaultRecoveryRating != null ? String(defaultRecoveryRating) : "3"
  );
  const [dietaryRestrictions, setDietaryRestrictions] = useState(
    lastCheckin?.dietaryRestrictions ?? ""
  );
  const [applyDate, setApplyDate] = useState(todayIso());

  const [result, setResult] = useState<CheckInResult | null>(null);
  const [macros, setMacros] = useState<{ proteinG: number; carbsG: number; fatG: number } | null>(
    null
  );
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const canRun =
    prevWeight.trim() !== "" && currWeight.trim() !== "" && currentCalories.trim() !== "";

  function handleRun() {
    setSaved(false);
    setError(null);
    const engineResult = runCheckInEngine({
      phase,
      prevWeightLbs: Number(prevWeight),
      currWeightLbs: Number(currWeight),
      currentCalories: Number(currentCalories),
      adherenceDays: Number(adherenceDays),
      recoveryRating: Number(recoveryRating),
      consecutiveSurplusSpikes: lastCheckin?.consecutiveSurplusSpikes ?? 0,
    });
    setResult(engineResult);
    const archetype = detectDietArchetype(dietaryRestrictions);
    const split = computeArchetypeMacros(engineResult.newCalories, Number(currWeight), archetype);
    setMacros({ proteinG: split.proteinG, carbsG: split.carbsG, fatG: split.fatG });
  }

  async function handleSave() {
    if (!result || !macros) return;
    setSaving(true);
    setError(null);
    const supabase = createBrowserClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    const archetype = detectDietArchetype(dietaryRestrictions);

    const { error: checkinError } = await supabase.from("nutrition_checkins").insert({
      athlete_id: athleteId,
      group_id: groupId,
      phase,
      prev_weight_lbs: Number(prevWeight),
      curr_weight_lbs: Number(currWeight),
      current_calories: Number(currentCalories),
      adherence_days: Number(adherenceDays),
      recovery_rating: Number(recoveryRating),
      new_calories: result.newCalories,
      rationale: result.rationale,
      consecutive_surplus_spikes: result.consecutiveSurplusSpikes,
      diet_archetype: archetype,
      dietary_restrictions: dietaryRestrictions,
      protein_g: macros.proteinG,
      carbs_g: macros.carbsG,
      fat_g: macros.fatG,
      created_by: user?.id,
    });

    if (checkinError) {
      setError("Couldn't save the check-in — check your connection and try again.");
      setSaving(false);
      return;
    }

    const { error: macroError } = await supabase.from("daily_macros").upsert(
      {
        athlete_id: athleteId,
        group_id: groupId,
        log_date: applyDate,
        calories: result.newCalories,
        protein_g: macros.proteinG,
        carbs_g: macros.carbsG,
        fat_g: macros.fatG,
        created_by: user?.id,
      },
      { onConflict: "athlete_id,log_date" }
    );

    if (macroError) {
      setError("Check-in saved, but couldn't apply the new targets to that date.");
      setSaving(false);
      return;
    }

    setSaving(false);
    setSaved(true);
  }

  return (
    <div>
      <h3 className="font-body text-xs text-steel uppercase tracking-wide mb-1">Weekly check-in</h3>
      <p className="font-body text-xs text-steel mb-3 max-w-[60ch]">
        Runs the same weekly calorie-adjustment rules as your own check-in tool, using this
        client&apos;s real logged weight and wellness data instead of re-typing it.
      </p>

      <div className="grid grid-cols-2 gap-3">
        <label className="flex flex-col gap-1">
          <span className="font-body text-[10px] text-steel uppercase tracking-wide">Phase</span>
          <select
            value={phase}
            onChange={(e) => setPhase(e.target.value as NutritionPhase)}
            className="h-9 bg-graphite border border-steel/30 text-chalk px-2 font-body text-sm"
          >
            {(Object.keys(PHASE_LABELS) as NutritionPhase[]).map((p) => (
              <option key={p} value={p}>
                {PHASE_LABELS[p]}
              </option>
            ))}
          </select>
        </label>

        <label className="flex flex-col gap-1">
          <span className="font-body text-[10px] text-steel uppercase tracking-wide">
            Adherence (days/7)
          </span>
          <input
            type="number"
            min={0}
            max={7}
            value={adherenceDays}
            onChange={(e) => setAdherenceDays(e.target.value)}
            className="h-9 bg-graphite border border-steel/30 text-chalk px-2 font-body text-sm"
          />
        </label>

        <label className="flex flex-col gap-1">
          <span className="font-body text-[10px] text-steel uppercase tracking-wide">
            Last week&apos;s avg weight (lbs)
          </span>
          <input
            type="number"
            step="0.1"
            value={prevWeight}
            onChange={(e) => setPrevWeight(e.target.value)}
            className="h-9 bg-graphite border border-steel/30 text-chalk px-2 font-body text-sm"
          />
        </label>

        <label className="flex flex-col gap-1">
          <span className="font-body text-[10px] text-steel uppercase tracking-wide">
            This week&apos;s avg weight (lbs)
          </span>
          <input
            type="number"
            step="0.1"
            value={currWeight}
            onChange={(e) => setCurrWeight(e.target.value)}
            className="h-9 bg-graphite border border-steel/30 text-chalk px-2 font-body text-sm"
          />
        </label>

        <label className="flex flex-col gap-1">
          <span className="font-body text-[10px] text-steel uppercase tracking-wide">
            Current daily calories
          </span>
          <input
            type="number"
            value={currentCalories}
            onChange={(e) => setCurrentCalories(e.target.value)}
            className="h-9 bg-graphite border border-steel/30 text-chalk px-2 font-body text-sm"
          />
        </label>

        <label className="flex flex-col gap-1">
          <span className="font-body text-[10px] text-steel uppercase tracking-wide">
            Recovery (1-5)
          </span>
          <input
            type="number"
            min={1}
            max={5}
            value={recoveryRating}
            onChange={(e) => setRecoveryRating(e.target.value)}
            className="h-9 bg-graphite border border-steel/30 text-chalk px-2 font-body text-sm"
          />
        </label>

        <label className="flex flex-col gap-1 col-span-2">
          <span className="font-body text-[10px] text-steel uppercase tracking-wide">
            Dietary restrictions / diet type
          </span>
          <input
            type="text"
            value={dietaryRestrictions}
            onChange={(e) => setDietaryRestrictions(e.target.value)}
            placeholder="e.g. keto, carnivore, no restrictions"
            className="h-9 bg-graphite border border-steel/30 text-chalk px-2 font-body text-sm"
          />
        </label>
      </div>

      <button
        type="button"
        onClick={handleRun}
        disabled={!canRun}
        className="h-10 px-4 mt-3 bg-rust text-graphite font-body text-sm font-medium disabled:opacity-40"
      >
        Run check-in
      </button>

      {result && macros && (
        <div className="mt-4 border border-steel/20 p-4 space-y-3">
          <p className="font-body text-sm text-chalk">{result.rationale}</p>
          <div className="grid grid-cols-4 gap-2 text-center">
            <div>
              <p className="font-display text-lg leading-none">{result.newCalories}</p>
              <p className="font-body text-[10px] text-steel uppercase mt-1">Kcal</p>
            </div>
            <div>
              <p className="font-display text-lg leading-none">{macros.proteinG}</p>
              <p className="font-body text-[10px] text-steel uppercase mt-1">Protein</p>
            </div>
            <div>
              <p className="font-display text-lg leading-none">{macros.carbsG}</p>
              <p className="font-body text-[10px] text-steel uppercase mt-1">Carbs</p>
            </div>
            <div>
              <p className="font-display text-lg leading-none">{macros.fatG}</p>
              <p className="font-body text-[10px] text-steel uppercase mt-1">Fat</p>
            </div>
          </div>

          <div className="flex items-center gap-2 pt-2 border-t border-steel/15">
            <label className="flex items-center gap-2 font-body text-xs text-steel">
              Apply to
              <input
                type="date"
                value={applyDate}
                onChange={(e) => setApplyDate(e.target.value)}
                className="h-8 bg-graphite border border-steel/30 text-chalk px-2 font-body text-xs"
              />
            </label>
            <button
              type="button"
              onClick={handleSave}
              disabled={saving}
              className="h-8 px-3 bg-rust text-graphite font-body text-xs font-medium disabled:opacity-40"
            >
              {saving ? "Saving…" : "Save"}
            </button>
            {saved && <span className="font-body text-xs text-positive">Saved</span>}
          </div>
          <p className="font-body text-[11px] text-steel">
            To apply this across the coming week instead of one day at a time, use the
            date-range assignment on this client&apos;s calendar.
          </p>
        </div>
      )}

      {error && (
        <p className="font-body text-xs text-rust mt-2" role="alert">
          {error}
        </p>
      )}
    </div>
  );
}
