"use client";

import { useRef, useState } from "react";
import { createBrowserClient } from "@/lib/supabase/client";
import type { FoodLogEntry } from "./meal-checkoff-list";

function fileToBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const result = reader.result as string;
      resolve(result.slice(result.indexOf(",") + 1));
    };
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(file);
  });
}

// V2 #3 from calorie_tracking_ux_research_and_plan.md — sequenced last
// deliberately (real accuracy limits, see the API route's own comment).
// Macros only, always shown for confirmation before saving — same
// discipline as every other estimate in this app.
export function PhotoLogFoodButton({
  athleteId,
  groupId,
  logDate,
  onLogged,
}: {
  athleteId: string;
  groupId: string;
  logDate: string;
  onLogged: (entry: FoodLogEntry) => void;
}) {
  const fileInputRef = useRef<HTMLInputElement>(null);
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

  async function handleFile(file: File) {
    setEstimating(true);
    setError(null);
    try {
      const base64 = await fileToBase64(file);
      const res = await fetch("/api/ai/parse-food-photo", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ imageBase64: base64, mediaType: file.type }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error ?? "Couldn't estimate that photo.");
        return;
      }
      setEstimate(data);
    } finally {
      setEstimating(false);
      if (fileInputRef.current) fileInputRef.current.value = "";
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
        meal_slot: null,
        status: "quick_log",
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
        mealSlot: null,
        status: "quick_log",
        description: estimate.description,
        calories: estimate.calories,
        proteinG: estimate.proteinG,
        carbsG: estimate.carbsG,
        fatG: estimate.fatG,
      });
      setEstimate(null);
    }
  }

  if (estimate) {
    return (
      <div className="border border-rust/40 bg-rust/5 p-3">
        <p className="font-body text-sm text-chalk">{estimate.description}</p>
        <p className="font-body text-xs text-steel mt-1">
          ~{estimate.calories} kcal · {estimate.proteinG}p / {estimate.carbsG}c / {estimate.fatG}f
        </p>
        <p className="font-body text-[11px] text-steel mt-1">
          Rough visual estimate — photo-based logging is the least precise option here.
        </p>
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
    );
  }

  return (
    <div>
      <input
        ref={fileInputRef}
        type="file"
        accept="image/*"
        capture="environment"
        className="hidden"
        onChange={(e) => {
          const file = e.target.files?.[0];
          if (file) handleFile(file);
        }}
      />
      {error && <p className="font-body text-xs text-rust mb-1.5">{error}</p>}
      <button
        type="button"
        onClick={() => fileInputRef.current?.click()}
        disabled={estimating}
        className="w-full h-10 border border-steel/30 text-steel font-body text-sm active:border-rust active:text-rust transition-colors disabled:opacity-40"
      >
        {estimating ? "Estimating from photo…" : "Take a photo"}
      </button>
    </div>
  );
}
