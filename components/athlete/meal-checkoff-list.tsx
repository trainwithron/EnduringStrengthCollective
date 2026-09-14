"use client";

import { useState } from "react";
import { createBrowserClient } from "@/lib/supabase/client";
import type { GeneratedMeal } from "@/lib/meal-engine";

export interface FoodLogEntry {
  id: string;
  mealSlot: string | null;
  status: "ate_it" | "modified" | "skipped" | "quick_log";
  description: string | null;
  calories: number | null;
  proteinG: number | null;
  carbsG: number | null;
  fatG: number | null;
}

// The flagship piece of real food logging (calorie_tracking_ux_research_
// and_plan.md, V1) — checking off a coach-prescribed meal instead of
// searching a food database, which is the actual competitive edge no
// consumer tracker can offer. "Ate it" logs the meal's own already-known
// target macros — zero typing, zero AI call, the fastest possible log.
// "Modified"/quick-log route through the AI estimate-then-confirm flow
// instead (see FreeTextFoodLog below) since only then is there real
// uncertainty to resolve.
export function MealCheckoffList({
  athleteId,
  groupId,
  logDate,
  meals,
  initialEntries,
  onEntryLogged,
}: {
  athleteId: string;
  groupId: string;
  logDate: string;
  meals: GeneratedMeal[];
  initialEntries: FoodLogEntry[];
  // Reports every newly-created entry back up so a parent tracking a
  // running daily total (food-log-section.tsx) stays accurate — this
  // component owns its own per-meal display state, but isn't the source
  // of truth for anything aggregated across the whole day.
  onEntryLogged?: (entry: FoodLogEntry) => void;
}) {
  const [entries, setEntries] = useState(initialEntries);
  const [savingSlot, setSavingSlot] = useState<string | null>(null);
  const [modifyingSlot, setModifyingSlot] = useState<string | null>(null);

  const entryBySlot = new Map(entries.filter((e) => e.mealSlot).map((e) => [e.mealSlot as string, e]));

  async function logMeal(meal: GeneratedMeal, status: "ate_it" | "skipped") {
    setSavingSlot(meal.spec.id);
    const { proteinTarget, carbsTarget, fatTarget } = meal.spec;
    const calories =
      status === "ate_it" ? Math.round(proteinTarget * 4 + carbsTarget * 4 + fatTarget * 9) : 0;
    const payload = {
      athlete_id: athleteId,
      group_id: groupId,
      log_date: logDate,
      meal_slot: meal.spec.id,
      status,
      calories: status === "ate_it" ? calories : 0,
      protein_g: status === "ate_it" ? proteinTarget : 0,
      carbs_g: status === "ate_it" ? carbsTarget : 0,
      fat_g: status === "ate_it" ? fatTarget : 0,
    };
    const supabase = createBrowserClient();
    const { data } = await supabase.from("food_log_entries").insert(payload).select("id").single();
    if (data) {
      const newEntry: FoodLogEntry = {
        id: data.id,
        mealSlot: meal.spec.id,
        status,
        description: null,
        calories: payload.calories,
        proteinG: payload.protein_g,
        carbsG: payload.carbs_g,
        fatG: payload.fat_g,
      };
      setEntries((prev) => [...prev.filter((e) => e.mealSlot !== meal.spec.id), newEntry]);
      onEntryLogged?.(newEntry);
    }
    setSavingSlot(null);
  }

  function handleModifiedLogged(meal: GeneratedMeal, entry: FoodLogEntry) {
    setEntries((prev) => [...prev.filter((e) => e.mealSlot !== meal.spec.id), entry]);
    onEntryLogged?.(entry);
    setModifyingSlot(null);
  }

  if (meals.length === 0) {
    return (
      <p className="font-body text-sm text-steel border border-steel/20 p-4">
        No meal plan set for today yet.
      </p>
    );
  }

  return (
    <div className="space-y-2">
      {meals.map((meal) => {
        const logged = entryBySlot.get(meal.spec.id);
        const primaryOption = meal.options[0];
        const saving = savingSlot === meal.spec.id;

        return (
          <div key={meal.spec.id} className="border border-steel/20 p-3">
            <div className="flex items-center justify-between gap-2">
              <div className="min-w-0">
                <p className="font-body text-sm text-chalk truncate">{meal.spec.title}</p>
                {primaryOption && (
                  <p className="font-body text-xs text-steel truncate">{primaryOption.recipeName}</p>
                )}
                <p className="font-body text-[11px] text-steel mt-0.5">
                  {meal.spec.proteinTarget}p / {meal.spec.carbsTarget}c / {meal.spec.fatTarget}f
                </p>
              </div>
            </div>

            {logged ? (
              <p className="font-body text-xs mt-2 flex items-center gap-1.5">
                <span
                  className={`w-1.5 h-1.5 rounded-full ${
                    logged.status === "skipped" ? "bg-steel" : "bg-moss"
                  }`}
                />
                {logged.status === "ate_it" && "Logged as eaten"}
                {logged.status === "modified" && `Logged (modified): ${logged.description ?? ""}`}
                {logged.status === "skipped" && "Skipped"}
              </p>
            ) : modifyingSlot === meal.spec.id ? (
              <FreeTextFoodLog
                athleteId={athleteId}
                groupId={groupId}
                logDate={logDate}
                mealSlot={meal.spec.id}
                status="modified"
                placeholder="What did you actually have instead?"
                onLogged={(entry) => handleModifiedLogged(meal, entry)}
                onCancel={() => setModifyingSlot(null)}
              />
            ) : (
              <div className="flex items-center gap-2 mt-2">
                <button
                  type="button"
                  onClick={() => logMeal(meal, "ate_it")}
                  disabled={saving}
                  className="h-8 px-3 bg-rust text-graphite font-body text-xs font-medium disabled:opacity-40"
                >
                  Ate it
                </button>
                <button
                  type="button"
                  onClick={() => setModifyingSlot(meal.spec.id)}
                  disabled={saving}
                  className="h-8 px-3 border border-steel/30 text-steel font-body text-xs active:border-rust active:text-rust transition-colors disabled:opacity-40"
                >
                  Modified
                </button>
                <button
                  type="button"
                  onClick={() => logMeal(meal, "skipped")}
                  disabled={saving}
                  className="h-8 px-3 font-body text-xs text-steel disabled:opacity-40"
                >
                  Skip
                </button>
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

// Shared AI-estimate-then-confirm flow — used both for "Modified" (tied
// to a specific planned meal) and the standalone quick-log entry point
// below. Always shows the estimate back before saving anything; never
// silently writes an AI guess.
export function FreeTextFoodLog({
  athleteId,
  groupId,
  logDate,
  mealSlot,
  status,
  placeholder,
  onLogged,
  onCancel,
}: {
  athleteId: string;
  groupId: string;
  logDate: string;
  mealSlot: string | null;
  status: "modified" | "quick_log";
  placeholder: string;
  onLogged: (entry: FoodLogEntry) => void;
  onCancel?: () => void;
}) {
  const [text, setText] = useState("");
  const [estimating, setEstimating] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [estimate, setEstimate] = useState<{
    description: string;
    calories: number;
    proteinG: number;
    carbsG: number;
    fatG: number;
  } | null>(null);

  async function handleEstimate() {
    if (!text.trim()) return;
    setEstimating(true);
    setError(null);
    try {
      const res = await fetch("/api/ai/parse-food-log", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error ?? "Couldn't estimate that.");
        return;
      }
      setEstimate(data);
    } finally {
      setEstimating(false);
    }
  }

  async function handleConfirm() {
    if (!estimate) return;
    setSaving(true);
    const supabase = createBrowserClient();
    const { data } = await supabase
      .from("food_log_entries")
      .insert({
        athlete_id: athleteId,
        group_id: groupId,
        log_date: logDate,
        meal_slot: mealSlot,
        status,
        description: estimate.description,
        calories: estimate.calories,
        protein_g: estimate.proteinG,
        carbs_g: estimate.carbsG,
        fat_g: estimate.fatG,
      })
      .select("id")
      .single();
    setSaving(false);
    if (data) {
      onLogged({
        id: data.id,
        mealSlot,
        status,
        description: estimate.description,
        calories: estimate.calories,
        proteinG: estimate.proteinG,
        carbsG: estimate.carbsG,
        fatG: estimate.fatG,
      });
    }
  }

  return (
    <div className="mt-2 space-y-2">
      {!estimate ? (
        <>
          <textarea
            value={text}
            onChange={(e) => setText(e.target.value)}
            placeholder={placeholder}
            rows={2}
            className="w-full bg-graphite border border-steel/30 text-chalk px-2 py-1.5 font-body text-sm focus:outline-none focus:border-rust resize-none"
          />
          {error && <p className="font-body text-xs text-rust">{error}</p>}
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={handleEstimate}
              disabled={estimating || !text.trim()}
              className="h-8 px-3 bg-rust text-graphite font-body text-xs font-medium disabled:opacity-40"
            >
              {estimating ? "Estimating…" : "Estimate"}
            </button>
            {onCancel && (
              <button
                type="button"
                onClick={onCancel}
                className="font-body text-xs text-steel"
              >
                Cancel
              </button>
            )}
          </div>
        </>
      ) : (
        <div className="border border-rust/40 bg-rust/5 p-3">
          <p className="font-body text-sm text-chalk">{estimate.description}</p>
          <p className="font-body text-xs text-steel mt-1">
            ~{estimate.calories} kcal · {estimate.proteinG}p / {estimate.carbsG}c / {estimate.fatG}f
          </p>
          <p className="font-body text-[11px] text-steel mt-1">Rough estimate — not lab-precise.</p>
          <div className="flex items-center gap-2 mt-2">
            <button
              type="button"
              onClick={handleConfirm}
              disabled={saving}
              className="h-8 px-3 bg-rust text-graphite font-body text-xs font-medium disabled:opacity-40"
            >
              {saving ? "Saving…" : "Confirm & log"}
            </button>
            <button
              type="button"
              onClick={() => setEstimate(null)}
              disabled={saving}
              className="font-body text-xs text-steel disabled:opacity-40"
            >
              Try again
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
