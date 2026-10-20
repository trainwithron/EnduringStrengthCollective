"use client";

import { useEffect, useRef, useState } from "react";
import { createBrowserClient } from "@/lib/supabase/client";
import type { FoodLogEntry } from "./meal-checkoff-list";
import { CustomFoodFormPanel } from "./custom-food-form";
import { CUSTOM_FOOD_SELECT, customFoodEntryProblem, customFoodEntryRow, customFoodFromRow, customFoodTitle, servingsProblem, type CustomFood, type CustomFoodRow } from "@/lib/custom-food";
import { FOOD_LOG_DETAIL_SELECT, defaultMealSlot, entryFromRow, type FoodLogRow } from "@/lib/food-entry";
import { normalizeBarcode } from "@/lib/food-barcode";
import { barcodeBasisLabel, scaleBarcodeResult, type BarcodeLookupResult } from "@/lib/open-food-facts";

// A scan looks in the client's OWN foods first (so a bar they created is found again), then the product database; when neither knows the code the client can create the food with
// the code already filled in and log it. Codes are compared without leading zeros (UPC-A and EAN-13 of the same product match).
//
// V2 #1 from calorie_tracking_ux_research_and_plan.md. Uses the native
// BarcodeDetector API (Chrome/Android) when available; where it is missing (Safari on an iPhone) the camera
// is read with the ZXing library instead, loaded only when a scan starts. Typing the number always works too. Same
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
        className="w-full min-h-[44px] border border-steel/30 text-steel font-body text-sm active:border-rust active:text-rust transition-colors"
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
  const [result, setResult] = useState<BarcodeLookupResult | null>(null);
  const [saving, setSaving] = useState(false);
  // A food of the client's own that matches the code, and the code nobody knew (so the client can create the food).
  const [ownFood, setOwnFood] = useState<CustomFood | null>(null);
  const [missCode, setMissCode] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [servings, setServings] = useState("1");

  useEffect(() => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const Detector = (window as any).BarcodeDetector;
    // No camera this browser can open at all: typing the number is the way.
    if (!navigator.mediaDevices?.getUserMedia) return;
    setCameraSupported(true);

    let stream: MediaStream | null = null;
    let stopped = false;
    let rafId: number;
    // The ZXing reader's own stop, when that path is used.
    let stopZxing: (() => void) | null = null;

    async function startNative() {
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
    }

    // Safari on an iPhone has no BarcodeDetector: the same four formats, read with ZXing (loaded only now, so nobody else downloads it).
    async function startZxing() {
      const [{ BrowserMultiFormatReader }, { BarcodeFormat, DecodeHintType }] = await Promise.all([import("@zxing/browser"), import("@zxing/library")]);
      if (stopped || !videoRef.current) return;
      const hints = new Map();
      hints.set(DecodeHintType.POSSIBLE_FORMATS, [BarcodeFormat.EAN_13, BarcodeFormat.UPC_A, BarcodeFormat.UPC_E, BarcodeFormat.EAN_8]);
      const reader = new BrowserMultiFormatReader(hints);
      const controls = await reader.decodeFromConstraints({ video: { facingMode: "environment" } }, videoRef.current, (found) => {
        if (!found || stopped) return;
        stopped = true;
        stopZxing?.();
        lookup(found.getText());
      });
      stopZxing = () => controls.stop();
      if (stopped) controls.stop();
    }

    (Detector ? startNative() : startZxing()).catch(() => {
      if (!stopped) setCameraError("Couldn't start the camera. You can still type the barcode below.");
    });

    return () => {
      stopped = true;
      if (rafId) cancelAnimationFrame(rafId);
      stream?.getTracks().forEach((t) => t.stop());
      stopZxing?.();
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
      setServings("1");
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
      .insert(customFoodEntryRow({ athleteId, groupId, logDate, mealSlot: defaultMealSlot(new Date().getHours(), new Date().getMinutes()), food: ownFood, qty }))
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
    if (!result || saving) return;
    // The amount eaten: servings of the label's basis (a serving, or 100 g).
    const scaled = scaleBarcodeResult(result, Number(servings));
    if ("problem" in scaled) {
      setError(scaled.problem);
      return;
    }
    const food = scaled.result;
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
        description: food.description,
        calories: food.calories,
        protein_g: food.proteinG,
        carbs_g: food.carbsG,
        fat_g: food.fatG,
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
        description: food.description,
        calories: food.calories,
        proteinG: food.proteinG,
        carbsG: food.carbsG,
        fatG: food.fatG,
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
    const qty = Number(servings);
    const preview = scaleBarcodeResult(result, qty);
    const per100g = result.basis === "100g";
    return (
      <div className="border border-rust/40 bg-rust/5 p-3" data-testid="barcode-result">
        <p className="font-body text-sm text-chalk">{result.description}</p>
        <p className="font-body text-xs text-steel mt-1 [font-variant-numeric:tabular-nums]">
          {barcodeBasisLabel(result.basis)}: {result.calories} kcal · {result.proteinG}p / {result.carbsG}c / {result.fatG}f
        </p>
        <p className="font-body text-xs text-steel mt-1">From the product&apos;s label data — double-check against the package if it looks off.</p>
        <div className="flex flex-wrap items-center gap-2 mt-2">
          <input type="number" inputMode="decimal" min="0" step="any" value={servings} onChange={(e) => setServings(e.target.value)} aria-label={per100g ? "Amount in 100 g" : "Servings"} className="w-20 min-h-[44px] bg-surface border border-steel/30 px-2 font-body text-sm text-chalk" />
          <span className="font-body text-xs text-steel">{per100g ? "x 100 g" : qty === 1 ? "serving" : "servings"}</span>
          {"result" in preview && qty !== 1 && (
            <span className="font-body text-xs text-chalk [font-variant-numeric:tabular-nums]">= {preview.result.calories} kcal · {preview.result.proteinG}p / {preview.result.carbsG}c / {preview.result.fatG}f</span>
          )}
        </div>
        <div className="flex items-center gap-2 mt-2">
          <button
            type="button"
            onClick={handleConfirm}
            disabled={saving}
            className="min-h-[44px] px-3 bg-rust text-graphite font-body text-xs font-medium disabled:opacity-40"
          >
            {saving ? "Saving…" : "Confirm & log"}
          </button>
          <button type="button" onClick={onCancel} disabled={saving} className="min-h-[44px] px-2 font-body text-xs text-steel disabled:opacity-40">
            Cancel
          </button>
        </div>
        {error && <p className="font-body text-xs text-rust mt-2" role="alert">{error}</p>}
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
        <input aria-label="Type barcode number"
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
      <button type="button" onClick={onCancel} className="min-h-[44px] px-2 font-body text-xs text-steel">
        Cancel
      </button>
    </div>
  );
}
