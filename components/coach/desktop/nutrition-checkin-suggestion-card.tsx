"use client";

import { useState } from "react";
import { createBrowserClient } from "@/lib/supabase/client";

export interface CheckinSuggestion {
  id: string;
  phase: string;
  prevWeightLbs: number;
  currWeightLbs: number;
  currentCalories: number;
  adherenceDays: number;
  recoveryRating: number;
  consecutiveSurplusSpikes: number;
  newCalories: number;
  rationale: string;
  proteinG: number;
  carbsG: number;
  fatG: number;
  adjustmentPct: number;
  generatedAt: string;
}

const PHASE_LABELS: Record<string, string> = {
  fat_loss: "Fat loss",
  hypertrophy: "Muscle building",
  maintenance: "Maintenance",
  reverse_diet: "Reverse diet",
};

// The proactive weekly cron's own output — a real recommendation, not
// yet applied to anything. "Apply" writes nutrition_checkins +
// daily_macros exactly like the manual panel's own Save button already
// does; "Dismiss" just marks it reviewed-and-skipped. Nothing here ever
// touches daily_macros until a coach explicitly clicks Apply.
export function NutritionCheckinSuggestionCard({
  athleteId,
  groupId,
  suggestion,
  onResolved,
}: {
  athleteId: string;
  groupId: string;
  suggestion: CheckinSuggestion;
  onResolved: () => void;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleApply() {
    setBusy(true);
    setError(null);
    const supabase = createBrowserClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    const todayKey = new Date().toISOString().slice(0, 10);

    const { error: checkinError } = await supabase.from("nutrition_checkins").insert({
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
    });
    if (checkinError) {
      setError("Couldn't apply — check your connection and try again.");
      setBusy(false);
      return;
    }

    const { error: macroError } = await supabase.from("daily_macros").upsert(
      {
        athlete_id: athleteId,
        group_id: groupId,
        log_date: todayKey,
        calories: suggestion.newCalories,
        protein_g: suggestion.proteinG,
        carbs_g: suggestion.carbsG,
        fat_g: suggestion.fatG,
        created_by: user?.id,
      },
      { onConflict: "athlete_id,log_date" }
    );
    if (macroError) {
      setError("Saved the check-in, but couldn't apply today's targets.");
      setBusy(false);
      return;
    }

    await supabase
      .from("nutrition_checkin_suggestions")
      .update({ status: "applied" })
      .eq("id", suggestion.id);
    setBusy(false);
    onResolved();
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
        <p className="font-body text-[10px] text-rust uppercase tracking-wide font-bold">
          Weekly check-in suggestion — {PHASE_LABELS[suggestion.phase] ?? suggestion.phase}
        </p>
        <p className="font-body text-[10px] text-steel">
          {new Date(suggestion.generatedAt).toLocaleDateString("en-US", { month: "short", day: "numeric" })}
        </p>
      </div>
      <p className="font-body text-sm text-chalk">{suggestion.rationale}</p>
      <div className="grid grid-cols-4 gap-2 text-center">
        <div>
          <p className="font-display text-lg leading-none">{suggestion.newCalories}</p>
          <p className="font-body text-[10px] text-steel uppercase mt-1">Kcal</p>
        </div>
        <div>
          <p className="font-display text-lg leading-none">{suggestion.proteinG}</p>
          <p className="font-body text-[10px] text-steel uppercase mt-1">Protein</p>
        </div>
        <div>
          <p className="font-display text-lg leading-none">{suggestion.carbsG}</p>
          <p className="font-body text-[10px] text-steel uppercase mt-1">Carbs</p>
        </div>
        <div>
          <p className="font-display text-lg leading-none">{suggestion.fatG}</p>
          <p className="font-body text-[10px] text-steel uppercase mt-1">Fat</p>
        </div>
      </div>
      {error && (
        <p className="font-body text-xs text-rust" role="alert">
          {error}
        </p>
      )}
      <div className="flex items-center gap-3 pt-2 border-t border-steel/15">
        <button
          type="button"
          onClick={handleApply}
          disabled={busy}
          className="h-9 px-3 bg-rust text-graphite font-body text-xs font-medium disabled:opacity-40"
        >
          {busy ? "…" : "Apply today"}
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
    </div>
  );
}
