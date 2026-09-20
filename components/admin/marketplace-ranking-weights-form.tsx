"use client";

import { useState } from "react";
import { createBrowserClient } from "@/lib/supabase/client";

interface Props {
  initialDistanceWeight: number;
  initialGoalFitWeight: number;
  initialOutcomeWeight: number;
  updatedAt: string | null;
}

export function MarketplaceRankingWeightsForm({
  initialDistanceWeight,
  initialGoalFitWeight,
  initialOutcomeWeight,
  updatedAt,
}: Props) {
  const [distance, setDistance] = useState(String(initialDistanceWeight));
  const [goalFit, setGoalFit] = useState(String(initialGoalFitWeight));
  const [outcome, setOutcome] = useState(String(initialOutcomeWeight));
  const [savedAt, setSavedAt] = useState(updatedAt);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const distanceNum = Number(distance) || 0;
  const goalFitNum = Number(goalFit) || 0;
  const outcomeNum = Number(outcome) || 0;
  const total = distanceNum + goalFitNum + outcomeNum;

  async function handleSave() {
    if (saving) return;
    setSaving(true);
    setError(null);
    try {
      const supabase = createBrowserClient();
      const {
        data: { user },
      } = await supabase.auth.getUser();
      const { data, error: updateError } = await supabase
        .from("marketplace_ranking_weights")
        .update({
          distance_weight: distanceNum,
          goal_fit_weight: goalFitNum,
          outcome_weight: outcomeNum,
          updated_by: user?.id ?? null,
          updated_at: new Date().toISOString(),
        })
        .eq("id", true)
        .select("updated_at")
        .single();
      if (updateError) throw updateError;
      setSavedAt(data.updated_at);
    } catch {
      setError("Couldn't save these weights.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-3 gap-3">
        <label className="flex flex-col gap-1">
          <span className="font-body text-xs text-steel uppercase tracking-wide">Distance</span>
          <input
            type="number"
            step="0.05"
            min="0"
            value={distance}
            onChange={(e) => setDistance(e.target.value)}
            className="bg-surface border border-steel/20 rounded-token-md px-3 py-2 font-body text-sm text-chalk"
          />
        </label>
        <label className="flex flex-col gap-1">
          <span className="font-body text-xs text-steel uppercase tracking-wide">Goal Fit</span>
          <input
            type="number"
            step="0.05"
            min="0"
            value={goalFit}
            onChange={(e) => setGoalFit(e.target.value)}
            className="bg-surface border border-steel/20 rounded-token-md px-3 py-2 font-body text-sm text-chalk"
          />
        </label>
        <label className="flex flex-col gap-1">
          <span className="font-body text-xs text-steel uppercase tracking-wide">Outcome</span>
          <input
            type="number"
            step="0.05"
            min="0"
            value={outcome}
            onChange={(e) => setOutcome(e.target.value)}
            className="bg-surface border border-steel/20 rounded-token-md px-3 py-2 font-body text-sm text-chalk"
          />
        </label>
      </div>

      <p className={`font-body text-xs ${Math.abs(total - 1) > 0.01 ? "text-rust" : "text-steel"}`}>
        Sum: {total.toFixed(2)}
        {Math.abs(total - 1) > 0.01
          ? " — doesn't need to be exactly 1.00 (the ranking normalizes it), but keeping it near 1 keeps these numbers legible as percentages."
          : ""}
      </p>

      <button
        onClick={handleSave}
        disabled={saving}
        className="bg-rust text-chalk font-body text-sm font-medium px-4 py-2 rounded-token-md disabled:opacity-50"
      >
        {saving ? "Saving…" : "Save weights"}
      </button>

      {error && <p className="font-body text-xs text-rust">{error}</p>}
      {savedAt && (
        <p className="font-body text-xs text-steel">Last updated {new Date(savedAt).toLocaleString()}</p>
      )}

      <p className="font-body text-xs text-steel border-t border-steel/15 pt-4 mt-2">
        The outcome factor only applies to weight-loss and endurance-event goals, where a real
        past-client outcome signal exists today. Every other goal type ranks on distance and goal fit
        only, re-normalized — the outcome weight above is simply unused for those searches.
      </p>
    </div>
  );
}
