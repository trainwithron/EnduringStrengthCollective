"use client";

import { useRef, useState } from "react";
import { createBrowserClient } from "@/lib/supabase/client";
import { defaultMealSlot } from "@/lib/food-entry";
import type { FoodLogEntry } from "./meal-checkoff-list";
import { Camera } from "lucide-react";
import { LOG_TILE_CLASS } from "./log-tile";

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
  // Audit C6 (Nov 21): the camera, or the phone's photos (like InBody). The two inputs are always on the page, so "Try again" can open the same one again in the same tap (C21).
  const cameraRef = useRef<HTMLInputElement>(null);
  const galleryRef = useRef<HTMLInputElement>(null);
  const lastPicker = useRef<"camera" | "gallery">("camera");
  const [choosing, setChoosing] = useState(false);
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
      if (cameraRef.current) cameraRef.current.value = "";
      if (galleryRef.current) galleryRef.current.value = "";
    }
  }

  function openPicker(which: "camera" | "gallery") {
    lastPicker.current = which;
    setChoosing(false);
    (which === "camera" ? cameraRef : galleryRef).current?.click();
  }

  const inputs = (
    <>
      <input ref={cameraRef} type="file" accept="image/*" capture="environment" className="hidden" tabIndex={-1} aria-hidden="true" onChange={(e) => {
        const file = e.target.files?.[0];
        if (file) handleFile(file);
      }} />
      <input ref={galleryRef} type="file" accept="image/*" className="hidden" tabIndex={-1} aria-hidden="true" onChange={(e) => {
        const file = e.target.files?.[0];
        if (file) handleFile(file);
      }} />
    </>
  );

  async function handleConfirm() {
    if (!estimate) return;
    // into the meal for the time of day
    const mealSlot = defaultMealSlot(new Date().getHours(), new Date().getMinutes());
    setSaving(true);
    setError(null);
    const supabase = createBrowserClient();
    const { data, error: saveError } = await supabase
      .from("food_log_entries")
      .insert({
        athlete_id: athleteId,
        group_id: groupId,
        log_date: logDate,
        meal_slot: mealSlot,
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
    // A save that did not land keeps the estimate on screen and says so (it used to do nothing at all).
    if (saveError || !data) {
      setError("That didn't save. Your estimate is still here: check your connection and tap Confirm & log again.");
      return;
    }
    if (data) {
      onLogged({
        id: data.id,
        mealSlot,
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
      <div className="basis-full order-last min-w-0 tint-accent rounded-card p-3">
        {inputs}
        <p className="font-body text-sm text-chalk">{estimate.description}</p>
        <p className="font-body text-xs text-steel mt-1">
          ~{estimate.calories} kcal · {estimate.proteinG}p / {estimate.carbsG}c / {estimate.fatG}f
        </p>
        <p className="font-body text-xs text-steel mt-1">
          Rough visual estimate — photo-based logging is the least precise option here.
        </p>
        {error && (
          <p className="font-body text-xs text-rust-ink mt-1" role="alert">
            {error}
          </p>
        )}
        <div className="flex items-center gap-2 mt-2">
          <button
            type="button"
            onClick={handleConfirm}
            disabled={saving}
            className="h-11 px-3 bg-rust text-graphite font-body text-xs font-medium disabled:opacity-40"
          >
            {saving ? "Saving…" : "Confirm & log"}
          </button>
          {/* Audit C21: Try again opens the camera or photos again (the one used last), not just clears the estimate. */}
          <button
            type="button"
            onClick={() => {
              setEstimate(null);
              openPicker(lastPicker.current);
            }}
            disabled={saving}
            className="min-h-11 px-3 font-body text-xs text-steel disabled:opacity-40"
            data-photo-try-again
          >
            Try again
          </button>
        </div>
      </div>
    );
  }

  // A tile in the row of three (Look Refresh, Nov 20); a problem shows full width under the row.
  return (
    <>
      {inputs}
      <button
        type="button"
        onClick={() => setChoosing((c) => !c)}
        disabled={estimating}
        aria-expanded={choosing}
        aria-label={estimating ? "Estimating from photo" : "Log food from a photo"}
        className={LOG_TILE_CLASS}
      >
        <Camera className="w-[22px] h-[22px] text-rust-ink" aria-hidden="true" />
        {estimating ? "Estimating…" : "Photo"}
      </button>
      {choosing && (
        <div className="basis-full order-last grid grid-cols-2 gap-2.5" data-photo-choice>
          <button type="button" onClick={() => openPicker("camera")} className="min-h-11 px-3 rounded-token-pill bg-rust text-graphite font-body text-sm font-semibold">
            Take a photo
          </button>
          <button type="button" onClick={() => openPicker("gallery")} className="min-h-11 px-3 rounded-token-pill border border-rust/50 text-rust-ink font-body text-sm font-semibold">
            Choose from photos
          </button>
        </div>
      )}
      {error && <p className="basis-full order-last font-body text-xs text-rust-ink" role="alert">{error}</p>}
    </>
  );
}
