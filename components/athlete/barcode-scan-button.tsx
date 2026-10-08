"use client";

import { useEffect, useRef, useState } from "react";
import { createBrowserClient } from "@/lib/supabase/client";
import type { FoodLogEntry } from "./meal-checkoff-list";
import { CustomFoodFormPanel } from "./custom-food-form";
import { CUSTOM_FOOD_SELECT, customFoodEntryProblem, customFoodEntryRow, customFoodFromRow, customFoodTitle, servingsProblem, type CustomFood, type CustomFoodRow } from "@/lib/custom-food";
import { FOOD_LOG_DETAIL_SELECT, entryFromRow, type FoodLogRow } from "@/lib/food-entry";
import { normalizeBarcode } from "@/lib/food-barcode";

// A scan looks in the client's OWN foods first (so a bar they created is found again), then the product database; when neither knows the code the client can create the food with
// the code already filled in and log it. Codes are compared without leading zeros (UPC-A and EAN-13 of the same product match).
//
// V2 #1 from calorie_tracking_ux_research_and_plan.md. Uses the native
// BarcodeDetector API (Chrome/Android — no library needed) when
// available; always offers manual barcode-number entry too, since
// Safari/iOS doesn't implement BarcodeDetector as of this build. Same
// confirm-before-save discipline as every other AI/estimated figure in
// this app — a barcode lookup is community-sourced data, not verified.
export function BarcodeScanButton({
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
  const [open, setOpen] = useState(false);

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="w-full h-10 border border-steel/30 text-steel font-body text-sm active:border-rust active:text-rust transition-colors"
      >
        Scan a barcode
      </button>
    );
  }

  return (
    <BarcodeScanPanel
      athleteId={athleteId}
      groupId={groupId}
      logDate={logDate}
      onLogged={(entry) => {
        onLogged(entry);
        setOpen(false);
      }}
      onCancel={() => setOpen(false)}
    />
  );
}

function BarcodeScanPanel({
  athleteId,
  groupId,
  logDate,
  onLogged,
  onCancel,
}: {
  athleteId: string;
  groupId: string;
  logDate: string;
  onLogged: (entry: FoodLogEntry) => void;
  onCancel: () => void;
}) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const [cameraSupported, setCameraSupported] = useState(false);
  const [cameraError, setCameraError] = useState<string | null>(null);
  const [manualCode, setManualCode] = useState("");
  const [looking, setLooking] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<{
    description: string;
    calories: number;
    proteinG: number;
    carbsG: number;
    fatG: number;
  } | null>(null);
  const [saving, setSaving] = useState(false);
  // A food of the client's own that matches the code, and the code nobody knew (so the client can create the food).
  const [ownFood, setOwnFood] = useState<CustomFood | null>(null);
  const [missCode, setMissCode] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [servings, setServings] = useState("1");

  useEffect(() => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const Detector = (window as any).BarcodeDetector;
    if (!Detector) return;
    setCameraSupported(true);

    let stream: MediaStream | null = null;
    let stopped = false;
    let rafId: number;

    async function start() {
      try {
        stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: "environment" } });
        if (stopped || !videoRef.current) return;
        videoRef.current.srcObject = stream;
        await videoRef.current.play();
        const detector = new Detector({ formats: ["ean_13", "upc_a", "upc_e", "ean_8"] });

        async function tick() {
          if (stopped || !videoRef.current) return;
          try {
            const codes = await detector.detect(videoRef.current);
            if (codes.length > 0 && !stopped) {
              stopped = true;
              lookup(codes[0].rawValue);
              return;
            }
          } catch {
            // transient decode errors are normal mid-scan; keep trying
          }
          rafId = requestAnimationFrame(tick);
        }
        rafId = requestAnimationFrame(tick);
      } catch {
        setCameraError("Couldn't access the camera — you can still type the barcode below.");
      }
    }
    start();

    return () => {
      stopped = true;
      if (rafId) cancelAnimationFrame(rafId);
      stream?.getTracks().forEach((t) => t.stop());
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function lookup(code: string) {
    setLooking(true);
    setError(null);
    setMissCode(null);
    try {
      // 1. The client's own foods, by the code without leading zeros. If this read fails we carry on to the product database.
      const normalized = normalizeBarcode(code);
      if (normalized !== "") {
        const own = await createBrowserClient().from("custom_foods").select(CUSTOM_FOOD_SELECT).eq("athlete_id", athleteId).eq("barcode", normalized).limit(1);
        const found = ((own.data ?? []) as unknown as CustomFoodRow[])[0];
        if (!own.error && found) {
          setOwnFood(customFoodFromRow(found));
          return;
        }
      }
      // 2. The product database.
      const res = await fetch("/api/food/barcode", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ barcode: code }),
      });
      const data = await res.json();
      if (!res.ok) {
        // Nobody knows this code: offer to create the food.
        if (res.status === 404 && normalized !== "") {
          setMissCode(code.replace(/\D/g, ""));
          return;
        }
        setError(data.error ?? "Couldn't find that barcode.");
        return;
      }
      setResult(data);
    } finally {
      setLooking(false);
    }
  }

  async function logOwnFood() {
    if (!ownFood || saving) return;
    const qty = Number(servings);
    const problem = servingsProblem(qty) ?? customFoodEntryProblem(ownFood, qty);
    if (problem) {
      setError(problem);
      return;
    }
    setSaving(true);
    setError(null);
    const { data, error: e } = await createBrowserClient()
      .from("food_log_entries")
      .insert(customFoodEntryRow({ athleteId, groupId, logDate, mealSlot: null, food: ownFood, qty }))
      .select(FOOD_LOG_DETAIL_SELECT)
      .single();
    setSaving(false);
    if (e || !data) {
      setError("That didn't save. Try again.");
      return;
    }
    onLogged(entryFromRow(data as unknown as FoodLogRow));
  }

  async function handleConfirm() {
    if (!result) return;
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
        description: result.description,
        calories: result.calories,
        protein_g: result.proteinG,
        carbs_g: result.carbsG,
        fat_g: result.fatG,
      })
      .select("id")
      .single();
    setSaving(false);
    if (data) {
      onLogged({
        id: data.id,
        mealSlot: null,
        status: "quick_log",
        description: result.description,
        calories: result.calories,
        proteinG: result.proteinG,
        carbsG: result.carbsG,
        fatG: result.fatG,
      });
    }
  }

  if (creating && missCode) {
    return (
      <CustomFoodFormPanel
        athleteId={athleteId}
        barcode={missCode}
        onSaved={(food) => {
          setOwnFood(food);
          setCreating(false);
          setMissCode(null);
        }}
        onCancel={() => setCreating(false)}
      />
    );
  }

  if (ownFood) {
    const qty = Number(servings);
    return (
      <div className="border border-rust/40 bg-rust/5 p-3" data-testid="barcode-own-food">
        <p className="font-body text-sm text-chalk">{customFoodTitle(ownFood)}</p>
        <p className="font-body text-xs text-steel mt-1 [font-variant-numeric:tabular-nums]">
          Per {ownFood.servingLabel}: {Math.round(ownFood.calories)} kcal · {ownFood.proteinG}p / {ownFood.carbsG}c / {ownFood.fatG}f
        </p>
        <p className="font-body text-xs text-steel mt-1">One of your own foods.</p>
        <div className="flex flex-wrap items-center gap-2 mt-2">
          <input type="number" inputMode="decimal" min="0" step="any" value={servings} onChange={(e) => setServings(e.target.value)} aria-label="Servings" className="w-20 min-h-[44px] bg-surface border border-steel/30 px-2 font-body text-sm text-chalk" />
          <button type="button" onClick={logOwnFood} disabled={saving} className="min-h-[44px] px-3 bg-rust text-graphite font-body text-xs font-medium disabled:opacity-40">
            {saving ? "Saving…" : `Log ${servings || "0"} ${qty === 1 ? "serving" : "servings"}`}
          </button>
          <button type="button" onClick={onCancel} disabled={saving} className="min-h-[44px] px-2 font-body text-xs text-steel disabled:opacity-40">
            Cancel
          </button>
        </div>
        {error && <p className="font-body text-xs text-rust mt-2" role="alert">{error}</p>}
      </div>
    );
  }

  if (result) {
    return (
      <div className="border border-rust/40 bg-rust/5 p-3">
        <p className="font-body text-sm text-chalk">{result.description}</p>
        <p className="font-body text-xs text-steel mt-1">
          {result.calories} kcal · {result.proteinG}p / {result.carbsG}c / {result.fatG}f
        </p>
        <p className="font-body text-xs text-steel mt-1">From the product&apos;s label data — double-check against the package if it looks off.</p>
        <div className="flex items-center gap-2 mt-2">
          <button
            type="button"
            onClick={handleConfirm}
            disabled={saving}
            className="h-11 px-3 bg-rust text-graphite font-body text-xs font-medium disabled:opacity-40"
          >
            {saving ? "Saving…" : "Confirm & log"}
          </button>
          <button type="button" onClick={onCancel} disabled={saving} className="font-body text-xs text-steel disabled:opacity-40">
            Cancel
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="border border-steel/20 p-3 space-y-2">
      {cameraSupported && !cameraError && (
        <video ref={videoRef} className="w-full aspect-video bg-black" muted playsInline />
      )}
      {cameraError && <p className="font-body text-xs text-steel">{cameraError}</p>}
      {!cameraSupported && (
        <p className="font-body text-xs text-steel">
          Camera scanning isn&apos;t supported on this browser — type the barcode number instead.
        </p>
      )}
      {looking && <p className="font-body text-xs text-steel">Looking that up…</p>}
      {error && <p className="font-body text-xs text-rust">{error}</p>}
      {missCode && (
        <div className="border border-steel/20 p-2.5" data-testid="barcode-not-found">
          <p className="font-body text-sm text-chalk">We couldn&apos;t find that barcode.</p>
          <p className="font-body text-xs text-steel mt-0.5">You can add it yourself with the numbers from the label. Next time you scan it, it will be found.</p>
          <button type="button" onClick={() => setCreating(true)} className="min-h-[44px] mt-1.5 px-3 bg-rust text-graphite font-body text-xs font-medium">
            Create this food
          </button>
        </div>
      )}

      <div className="flex items-center gap-2">
        <input
          type="text"
          inputMode="numeric"
          value={manualCode}
          onChange={(e) => setManualCode(e.target.value.replace(/\D/g, ""))}
          placeholder="Type barcode number"
          className="flex-1 h-11 bg-graphite border border-steel/30 text-chalk px-2 font-body text-sm focus:outline-none focus:border-rust"
        />
        <button
          type="button"
          onClick={() => manualCode && lookup(manualCode)}
          disabled={!manualCode || looking}
          className="h-11 px-3 bg-rust text-graphite font-body text-xs font-medium disabled:opacity-40"
        >
          Look up
        </button>
      </div>
      <button type="button" onClick={onCancel} className="font-body text-xs text-steel">
        Cancel
      </button>
    </div>
  );
}
