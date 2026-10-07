"use client";

import { useState } from "react";
import { createBrowserClient } from "@/lib/supabase/client";
import { clampApplyFrom } from "@/lib/apply-from";
import { applyStandingTarget, insertCheckinOnce, pushMessageForApply, type ApplyPlan } from "@/lib/apply-standing";
import { notifyPush } from "@/lib/push-notify";
import { isBelowFloor } from "@/lib/calorie-floor";
import { ensurePhasePlan } from "@/lib/phase-plan-write";
import { AGE_UNKNOWN_NOTE } from "@/lib/minor-safety";
import type { NutritionPhase } from "@/lib/nutrition-checkin";
import { ApplyFromField } from "@/components/coach/nutrition/apply-from-field";
import { CalorieFloorWarning } from "@/components/coach/nutrition/calorie-floor-warning";
import { ApplyOutcomeNotice } from "@/components/coach/nutrition/apply-outcome-notice";

export interface CheckinSuggestion {
  id: string;
  phase: string;
  // A starting target for a new client has no previous week, so a baseline has none of these five.
  kind: "weekly" | "baseline";
  prevWeightLbs: number | null;
  currWeightLbs: number | null;
  currentCalories: number | null;
  adherenceDays: number | null;
  recoveryRating: number | null;
  consecutiveSurplusSpikes: number;
  newCalories: number;
  rationale: string;
  proteinG: number;
  carbsG: number;
  fatG: number;
  adjustmentPct: number | null;
  belowFloor?: boolean;
  generatedAt: string;
}

const PHASE_LABELS: Record<string, string> = {
  fat_loss: "Fat loss",
  hypertrophy: "Muscle building",
  maintenance: "Maintenance",
  reverse_diet: "Reverse diet",
};

// The proactive weekly cron's own output — a real recommendation, not
// yet applied to anything. "Apply" records the check-in and writes the
// client's STANDING target from the chosen date (today by default, up to 14
// days ahead), the same as the manual check-in; a day that has its own
// one-day target keeps it. "Dismiss" just marks it reviewed-and-skipped.
// Nothing here changes a target until a coach explicitly clicks Apply.
export function NutritionCheckinSuggestionCard({
  athleteId,
  groupId,
  suggestion,
  onResolved,
  todayKey,
  floorCalories = null,
  floorNote = null,
  clientName = "this client",
  ageKnown = true,
}: {
  athleteId: string;
  groupId: string;
  suggestion: CheckinSuggestion;
  onResolved: () => void;
  // The coach's calendar day (computed on the server in the coach's zone) and the soft floor for this client, if it can be worked out.
  todayKey: string;
  floorCalories?: number | null;
  floorNote?: string | null;
  clientName?: string;
  // False when the client has no date of birth on file: the card says the under-18 rule could not be checked.
  ageKnown?: boolean;
}) {
  const [applyFrom, setApplyFrom] = useState(todayKey);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // A starting target also sets the client's phase when they have none; if that part fails the coach is told here.
  const [phaseNote, setPhaseNote] = useState<string | null>(null);
  const isBaseline = suggestion.kind === "baseline";
  // Set once the target is applied: the card then shows what the apply really did until the coach says Done.
  const [outcome, setOutcome] = useState<{ plan: ApplyPlan; startKey: string } | null>(null);

  async function handleApply() {
    setBusy(true);
    setError(null);
    const supabase = createBrowserClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    const startKey = clampApplyFrom(applyFrom, todayKey);

    // The target first, then the check-in record, so a retry after a half-failure re-applies the same target (harmless) and records the check-in only once.
    const target = { calories: suggestion.newCalories, proteinG: suggestion.proteinG, carbsG: suggestion.carbsG, fatG: suggestion.fatG };
    const applied = await applyStandingTarget(supabase, { athleteId, groupId, userId: user?.id ?? null, target, startKey, todayKey });
    if (!applied.ok) {
      setError("Couldn't apply the new target. Check your connection and try again.");
      setBusy(false);
      return;
    }

    const checkinRow = isBaseline
        ? {
            athlete_id: athleteId,
            group_id: groupId,
            kind: "baseline",
            phase: suggestion.phase,
            consecutive_surplus_spikes: 0,
            new_calories: suggestion.newCalories,
            rationale: suggestion.rationale,
            protein_g: suggestion.proteinG,
            carbs_g: suggestion.carbsG,
            fat_g: suggestion.fatG,
            created_by: user?.id,
          }
        : {
            athlete_id: athleteId,
            group_id: groupId,
            phase: suggestion.phase,
            prev_weight_lbs: suggestion.prevWeightLbs,
            curr_weight_lbs: suggestion.currWeightLbs,
            current_calories: suggestion.currentCalories,
            adherence_days: suggestion.adherenceDays,
            recovery_rating: suggestion.recoveryRating,
            consecutive_surplus_spikes: suggestion.consecutiveSurplusSpikes,
            new_calories: suggestion.newCalories,
            rationale: suggestion.rationale,
            protein_g: suggestion.proteinG,
            carbs_g: suggestion.carbsG,
            fat_g: suggestion.fatG,
            adjustment_pct: suggestion.adjustmentPct,
            created_by: user?.id,
          };
    const recorded = await insertCheckinOnce(supabase, checkinRow);
    if (!recorded.ok) {
      setError("The new target is applied, but the check-in could not be recorded. Press Apply again to finish; it will not apply twice.");
      setBusy(false);
      return;
    }

    if (isBaseline && user?.id) {
      // A client with no phase of record gets the one this target was worked out for; one who has a phase keeps it.
      const ensured = await ensurePhasePlan(supabase, { athleteId, groupId, coachId: user.id, phase: suggestion.phase as NutritionPhase, todayKey });
      if (!ensured.ok) setPhaseNote("The target is applied, but the phase could not be saved. Set it under Phase.");
    }
    await supabase.from("nutrition_checkin_suggestions").update({ status: "applied" }).eq("id", suggestion.id);
    notifyPush(
      athleteId,
      "New macro targets",
      pushMessageForApply({ newCalories: suggestion.newCalories, startKey, todayKey, todayChanged: applied.todayChanged }),
      `/groups/${groupId}/nutrition`
    );
    setBusy(false);
    setOutcome({ plan: applied, startKey });
  }

  async function handleDismiss() {
    setBusy(true);
    const supabase = createBrowserClient();
    await supabase.from("nutrition_checkin_suggestions").update({ status: "dismissed" }).eq("id", suggestion.id);
    setBusy(false);
    onResolved();
  }

  return (
    <div className="border border-rust/40 bg-surface/60 p-4 space-y-3">
      <div className="flex items-center justify-between">
        <p className="font-body text-xs text-rust uppercase tracking-wide font-bold">
          {isBaseline ? `Starting target for ${clientName}` : "Weekly check-in suggestion"} — {PHASE_LABELS[suggestion.phase] ?? suggestion.phase}
        </p>
        <p className="font-body text-xs text-steel">
          {new Date(suggestion.generatedAt).toLocaleDateString("en-US", { month: "short", day: "numeric" })}
        </p>
      </div>
      <p className="font-body text-sm text-chalk">{suggestion.rationale}</p>
      <div className="grid grid-cols-4 gap-2 text-center">
        <div>
          <p className="font-display text-lg leading-none">{suggestion.newCalories}</p>
          <p className="font-body text-xs text-steel uppercase mt-1">Kcal</p>
        </div>
        <div>
          <p className="font-display text-lg leading-none">{suggestion.proteinG}</p>
          <p className="font-body text-xs text-steel uppercase mt-1">Protein</p>
        </div>
        <div>
          <p className="font-display text-lg leading-none">{suggestion.carbsG}</p>
          <p className="font-body text-xs text-steel uppercase mt-1">Carbs</p>
        </div>
        <div>
          <p className="font-display text-lg leading-none">{suggestion.fatG}</p>
          <p className="font-body text-xs text-steel uppercase mt-1">Fat</p>
        </div>
      </div>
      <CalorieFloorWarning calories={suggestion.newCalories} floor={floorCalories} who={clientName} note={floorNote} />
      {!ageKnown && !isBaseline && (
        <p className="font-body text-xs text-rust" role="note">
          {AGE_UNKNOWN_NOTE}
        </p>
      )}
      {outcome ? (
        <div className="pt-2 border-t border-steel/15 space-y-2">
          <ApplyOutcomeNotice
            athleteId={athleteId}
            groupId={groupId}
            target={{ calories: suggestion.newCalories, proteinG: suggestion.proteinG, carbsG: suggestion.carbsG, fatG: suggestion.fatG }}
            plan={outcome.plan}
            startKey={outcome.startKey}
            todayKey={todayKey}
          />
          {phaseNote && <p className="font-body text-xs text-rust">{phaseNote}</p>}
          <button type="button" onClick={onResolved} className="h-9 px-3 bg-rust text-graphite font-body text-xs font-medium">
            Done
          </button>
        </div>
      ) : (
        <>
      {error && (
        <p className="font-body text-xs text-rust" role="alert">
          {error}
        </p>
      )}
      <div className="flex items-center gap-3 flex-wrap pt-2 border-t border-steel/15">
        <ApplyFromField value={applyFrom} onChange={setApplyFrom} todayKey={todayKey} disabled={busy} />
        <button
          type="button"
          onClick={handleApply}
          disabled={busy}
          className="h-9 px-3 bg-rust text-graphite font-body text-xs font-medium disabled:opacity-40"
        >
          {busy ? "…" : isBelowFloor(suggestion.newCalories, floorCalories ?? 0) ? "Apply anyway" : "Apply"}
        </button>
        <button
          type="button"
          onClick={handleDismiss}
          disabled={busy}
          className="font-body text-xs text-steel disabled:opacity-40"
        >
          Dismiss
        </button>
      </div>
        </>
      )}
    </div>
  );
}
