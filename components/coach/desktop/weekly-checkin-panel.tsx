"use client";

import { useState } from "react";
import { createBrowserClient } from "@/lib/supabase/client";
import { holdDeficitForMinor } from "@/lib/minor-safety";
import { displayWeightValue, parseWeightInput, type WeightUnit } from "@/lib/units";
import {
  runCheckInEngine,
  clampAdjustmentPct,
  DEFAULT_ADJUSTMENT_PCT,
  MIN_ADJUSTMENT_PCT,
  MAX_ADJUSTMENT_PCT,
  type NutritionPhase,
  type CheckInResult,
} from "@/lib/nutrition-checkin";
import { computeArchetypeMacros, detectDietArchetype } from "@/lib/macros";
import { clampApplyFrom, shortDateLabel } from "@/lib/apply-from";
import { applyStandingTarget, insertCheckinOnce, pushMessageForApply, type ApplyPlan } from "@/lib/apply-standing";
import { notifyPush } from "@/lib/push-notify";
import { isBelowFloor } from "@/lib/calorie-floor";
import { ApplyFromField } from "@/components/coach/nutrition/apply-from-field";
import { CalorieFloorWarning } from "@/components/coach/nutrition/calorie-floor-warning";
import { ApplyOutcomeNotice } from "@/components/coach/nutrition/apply-outcome-notice";

// Purely a display band for the slider below — the real min/max/step/
// default (1-15%, default 5%) are untouched; this just marks where most
// clients actually land within that full range.
const TYPICAL_MIN_PCT = 3;
const TYPICAL_MAX_PCT = 10;

const PHASE_LABELS: Record<NutritionPhase, string> = {
  fat_loss: "Fat loss",
  hypertrophy: "Muscle building",
  maintenance: "Maintenance",
  reverse_diet: "Reverse diet",
};

// Coach-facing action that runs Ron's own weekly calorie-periodization
// rules (lib/nutrition-checkin.ts, ported from his standalone check-in
// tool) against a specific client's real data instead of manually
// re-entering it: this week's/last week's average weight comes from
// body_weight_logs (weightTrend), a default recovery rating from the
// week's average wellness check-ins, and — now that real food logging
// exists (calorie_tracking_ux_research_and_plan.md) — a default
// adherence-days count derived from real food_log_entries instead of
// the old plain manual guess. All three stay fully editable.
export function WeeklyCheckinPanel({
  athleteId,
  groupId,
  weekAvgWeight,
  lastWeekAvgWeight,
  defaultCurrentCalories,
  defaultRecoveryRating,
  defaultAdherenceDays,
  lastCheckin,
  isInjured,
  maintenanceCalories,
  injurySurplusPct,
  defaultPhase,
  todayKey,
  floorCalories = null,
  floorNote = null,
  clientName = "this client",
  proteinGPerLb,
  defaultDietaryRestrictions = "",
  ageYears = null,
  weightUnit = "lb",
}: {
  athleteId: string;
  groupId: string;
  weekAvgWeight: number | null;
  lastWeekAvgWeight: number | null;
  defaultCurrentCalories: number | null;
  defaultRecoveryRating: number | null;
  defaultAdherenceDays?: number | null;
  lastCheckin: {
    phase: NutritionPhase;
    consecutiveSurplusSpikes: number;
    dietaryRestrictions: string;
    adjustmentPct: number;
  } | null;
  // coach_em_up_finley_funston_transcript.md — real client-safety
  // override. All optional/defaulted so every other caller of this
  // component (there are none today, but the pattern matters) sees
  // byte-identical behavior if it doesn't pass them.
  isInjured?: boolean;
  maintenanceCalories?: number | null;
  injurySurplusPct?: number;
  // progression_systems_and_phase_vocab_deep_dive_sept30.md — a prior
  // check-in's own phase is still the stronger signal for an ongoing
  // client (it's literally what this tool decided last time), so this
  // only backs it up when there's no check-in history yet at all — a
  // brand-new tagged client no longer always starts on "Fat loss."
  defaultPhase?: NutritionPhase | null;
  // The coach's calendar day (from the server, in the coach's zone) and the soft calorie floor for this client when it can be worked out.
  todayKey: string;
  floorCalories?: number | null;
  floorNote?: string | null;
  clientName?: string;
  // This client's own protein target in g per pound (their preferences); without it the platform's 1 g per pound.
  proteinGPerLb?: number;
  // The client's own food rules as one line (from their preferences). It wins over the text of an older check-in, which may be out of date.
  defaultDietaryRestrictions?: string;
  // The client's age in whole years, when their date of birth is on file. Under 18, a suggestion that would lower their calories is held at the current number.
  ageYears?: number | null;
  // How this client sees weight. The two weights are typed and shown in it; the engine and the saved check-in always use pounds.
  weightUnit?: WeightUnit;
}) {
  const toLbs = (text: string): number => parseWeightInput(text, weightUnit) ?? Number(text);
  const [phase, setPhase] = useState<NutritionPhase>(defaultPhase ?? lastCheckin?.phase ?? "fat_loss");
  const [adjustmentPct, setAdjustmentPct] = useState(lastCheckin?.adjustmentPct ?? DEFAULT_ADJUSTMENT_PCT);
  const [prevWeight, setPrevWeight] = useState(
    lastWeekAvgWeight != null ? String(displayWeightValue(lastWeekAvgWeight, weightUnit)) : ""
  );
  const [currWeight, setCurrWeight] = useState(weekAvgWeight != null ? String(displayWeightValue(weekAvgWeight, weightUnit)) : "");
  const [currentCalories, setCurrentCalories] = useState(
    defaultCurrentCalories != null ? String(defaultCurrentCalories) : ""
  );
  const [adherenceDays, setAdherenceDays] = useState(
    defaultAdherenceDays != null ? String(defaultAdherenceDays) : "7"
  );
  const [recoveryRating, setRecoveryRating] = useState(
    defaultRecoveryRating != null ? String(defaultRecoveryRating) : "3"
  );
  const [dietaryRestrictions, setDietaryRestrictions] = useState(
    defaultDietaryRestrictions || (lastCheckin?.dietaryRestrictions ?? "")
  );
  const [applyDate, setApplyDate] = useState(todayKey);
  // The standing target is always the default: a one-day target is the explicit exception.
  const [applyFrom, setApplyFrom] = useState(todayKey);
  const [applyMode, setApplyMode] = useState<"standing" | "date">("standing");

  const [result, setResult] = useState<CheckInResult | null>(null);
  const [macros, setMacros] = useState<{ proteinG: number; carbsG: number; fatG: number } | null>(
    null
  );
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  // What the standing-target apply really did (days that will not follow yet, whether today changed), shown after Save.
  const [outcome, setOutcome] = useState<{ plan: ApplyPlan; startKey: string; target: { calories: number; proteinG: number; carbsG: number; fatG: number } } | null>(null);
  const [error, setError] = useState<string | null>(null);

  const canRun =
    prevWeight.trim() !== "" && currWeight.trim() !== "" && currentCalories.trim() !== "";

  function handleRun() {
    setSaved(false);
    setOutcome(null);
    setError(null);
    const engineResult = runCheckInEngine({
      phase,
      prevWeightLbs: toLbs(prevWeight),
      currWeightLbs: toLbs(currWeight),
      currentCalories: Number(currentCalories),
      adherenceDays: Number(adherenceDays),
      recoveryRating: Number(recoveryRating),
      consecutiveSurplusSpikes: lastCheckin?.consecutiveSurplusSpikes ?? 0,
      adjustmentPct,
      isInjured,
      maintenanceCalories,
      injurySurplusPct,
    });
    // No calorie deficit is suggested for anyone under 18: the number is held at their current calories and the reason is added.
    const guarded = holdDeficitForMinor({ ageYears, currentCalories: Number(currentCalories), result: engineResult });
    setResult(guarded.result);
    const archetype = detectDietArchetype(dietaryRestrictions);
    const split = computeArchetypeMacros(guarded.result.newCalories, toLbs(currWeight), archetype, proteinGPerLb);
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

    const target = { calories: result.newCalories, proteinG: macros.proteinG, carbsG: macros.carbsG, fatG: macros.fatG };
    const standingStart = clampApplyFrom(applyFrom, todayKey);

    // The target first, then the check-in record, so a retry after a half-failure re-applies the same target (harmless) and records the check-in only once.
    let applied: Awaited<ReturnType<typeof applyStandingTarget>> | null = null;
    if (applyMode === "standing") {
      applied = await applyStandingTarget(supabase, { athleteId, groupId, userId: user?.id ?? null, target, startKey: standingStart, todayKey });
      if (!applied.ok) {
        setError("Couldn't apply the new target. Check your connection and try again.");
        setSaving(false);
        return;
      }
    } else {
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
        setError("Couldn't apply the new target to that date. Check your connection and try again.");
        setSaving(false);
        return;
      }
    }

    const recorded = await insertCheckinOnce(supabase, {
      athlete_id: athleteId,
      group_id: groupId,
      phase,
      prev_weight_lbs: toLbs(prevWeight),
      curr_weight_lbs: toLbs(currWeight),
      current_calories: Number(currentCalories),
      adherence_days: Number(adherenceDays),
      recovery_rating: Number(recoveryRating),
      new_calories: result.newCalories,
      rationale: result.rationale,
      consecutive_surplus_spikes: result.consecutiveSurplusSpikes,
      adjustment_pct: adjustmentPct,
      diet_archetype: archetype,
      dietary_restrictions: dietaryRestrictions,
      protein_g: macros.proteinG,
      carbs_g: macros.carbsG,
      fat_g: macros.fatG,
      created_by: user?.id,
    });
    if (!recorded.ok) {
      setError("The new target is applied, but the check-in could not be recorded. Press Save again to finish; it will not apply twice.");
      setSaving(false);
      return;
    }

    if (athleteId !== user?.id) {
      const message =
        applied && applied.ok
          ? pushMessageForApply({ newCalories: result.newCalories, startKey: standingStart, todayKey, todayChanged: applied.todayChanged })
          : `Your coach set a calorie target of ${result.newCalories.toLocaleString("en-US")} for ${shortDateLabel(applyDate)}`;
      notifyPush(athleteId, "New macro targets", message, `/groups/${groupId}/nutrition`);
    }
    if (applied && applied.ok) setOutcome({ plan: applied, startKey: standingStart, target });
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
          <span className="font-body text-xs text-steel uppercase tracking-wide">Phase</span>
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

        <label className="flex flex-col gap-1 col-span-2">
          <span className="font-body text-xs text-steel uppercase tracking-wide">
            Adjustment size — {adjustmentPct}% {phase === "reverse_diet" ? "increase" : "cut"}{" "}
            <span className="normal-case text-steel">(typical: {TYPICAL_MIN_PCT}-{TYPICAL_MAX_PCT}%)</span>
          </span>
          {/* The full range (1-15%) covers real edge cases, but most
              clients land in 3-10% — a bare slider gave that no visual
              distinction at all, reading as if every value in range were
              equally common. The shaded band marks where the track
              represents that typical zone; min/max/step/default are
              unchanged. */}
          <div className="relative flex items-center h-4">
            <div
              className="absolute h-1.5 bg-rust/20 rounded-token pointer-events-none"
              style={{
                left: `${((TYPICAL_MIN_PCT - MIN_ADJUSTMENT_PCT) / (MAX_ADJUSTMENT_PCT - MIN_ADJUSTMENT_PCT)) * 100}%`,
                width: `${((TYPICAL_MAX_PCT - TYPICAL_MIN_PCT) / (MAX_ADJUSTMENT_PCT - MIN_ADJUSTMENT_PCT)) * 100}%`,
              }}
            />
            <input
              type="range"
              min={MIN_ADJUSTMENT_PCT}
              max={MAX_ADJUSTMENT_PCT}
              step={1}
              value={adjustmentPct}
              onChange={(e) => setAdjustmentPct(clampAdjustmentPct(Number(e.target.value)))}
              className="relative w-full accent-rust"
            />
          </div>
          <span className="font-body text-xs text-steel">
            How big a planned calorie change to make when one&apos;s due — gentler for a client who
            needs a soft touch, bigger for one who can handle a real jump.
          </span>
        </label>

        <label className="flex flex-col gap-1">
          <span className="font-body text-xs text-steel uppercase tracking-wide">
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
          {defaultAdherenceDays != null && (
            <span className="font-body text-xs text-steel">
              From real logged days this week — still editable.
            </span>
          )}
        </label>

        <label className="flex flex-col gap-1">
          <span className="font-body text-xs text-steel uppercase tracking-wide">
            Last week&apos;s avg weight ({weightUnit})
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
          <span className="font-body text-xs text-steel uppercase tracking-wide">
            This week&apos;s avg weight ({weightUnit})
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
          <span className="font-body text-xs text-steel uppercase tracking-wide">
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
          <span className="font-body text-xs text-steel uppercase tracking-wide">
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
          <span className="font-body text-xs text-steel uppercase tracking-wide">
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
              <p className="font-body text-xs text-steel uppercase mt-1">Kcal</p>
            </div>
            <div>
              <p className="font-display text-lg leading-none">{macros.proteinG}</p>
              <p className="font-body text-xs text-steel uppercase mt-1">Protein</p>
            </div>
            <div>
              <p className="font-display text-lg leading-none">{macros.carbsG}</p>
              <p className="font-body text-xs text-steel uppercase mt-1">Carbs</p>
            </div>
            <div>
              <p className="font-display text-lg leading-none">{macros.fatG}</p>
              <p className="font-body text-xs text-steel uppercase mt-1">Fat</p>
            </div>
          </div>

          <CalorieFloorWarning calories={result.newCalories} floor={floorCalories} who={clientName} note={floorNote} />
          <div className="flex items-center gap-2 flex-wrap pt-2 border-t border-steel/15">
            <label className="flex items-center gap-2 font-body text-xs text-steel">
              Apply to
              <select
                value={applyMode}
                onChange={(e) => setApplyMode(e.target.value as "standing" | "date")}
                className="h-8 bg-graphite border border-steel/30 text-chalk px-2 font-body text-xs"
              >
                <option value="standing">Standing target (from a date)</option>
                <option value="date">One date only</option>
              </select>
            </label>
            {applyMode === "standing" && <ApplyFromField value={applyFrom} onChange={setApplyFrom} todayKey={todayKey} disabled={saving} />}
            {applyMode === "date" && (
              <input
                type="date"
                value={applyDate}
                onChange={(e) => setApplyDate(e.target.value)}
                aria-label="Date to apply to"
                className="h-8 bg-graphite border border-steel/30 text-chalk px-2 font-body text-xs"
              />
            )}
            <button
              type="button"
              onClick={handleSave}
              disabled={saving}
              className="h-8 px-3 bg-rust text-graphite font-body text-xs font-medium disabled:opacity-40"
            >
              {saving ? "Saving…" : isBelowFloor(result.newCalories, floorCalories ?? 0) ? "Save anyway" : "Save"}
            </button>
            {saved && !outcome && <span className="font-body text-xs text-positive">Saved</span>}
          </div>
          {outcome && (
            <ApplyOutcomeNotice athleteId={athleteId} groupId={groupId} target={outcome.target} plan={outcome.plan} startKey={outcome.startKey} todayKey={todayKey} />
          )}
          <p className="font-body text-xs text-steel">
            {applyMode === "standing"
              ? "Days that already have their own target keep it."
              : "To apply this across a range of dates, use the date-range assignment on this client's calendar."}
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
