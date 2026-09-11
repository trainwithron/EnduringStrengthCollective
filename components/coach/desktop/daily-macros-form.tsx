"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { createBrowserClient } from "@/lib/supabase/client";
import { PROTEIN_G_PER_LB, estimateProteinFromBodyWeight, fillCarbsAndFat as computeCarbsAndFat } from "@/lib/macros";
import { notifyPush } from "@/lib/push-notify";

export function DailyMacrosForm({
  athleteId,
  groupId,
  date,
  initial,
  latestBodyWeight,
}: {
  athleteId: string;
  groupId: string;
  date: string; // "YYYY-MM-DD"
  initial: { calories: number | null; proteinG: number | null; carbsG: number | null; fatG: number | null };
  latestBodyWeight: number | null;
}) {
  const [calories, setCalories] = useState(initial.calories?.toString() ?? "");
  const [protein, setProtein] = useState(initial.proteinG?.toString() ?? "");
  const [carbs, setCarbs] = useState(initial.carbsG?.toString() ?? "");
  const [fat, setFat] = useState(initial.fatG?.toString() ?? "");
  const [bodyWeight, setBodyWeight] = useState(latestBodyWeight?.toString() ?? "");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Was there ever a saved row for this day, independent of what's
  // currently typed in the form — governs whether "Clear this day" shows
  // at all, since there's nothing to clear on a day nobody has saved yet.
  const [hasSavedEntry, setHasSavedEntry] = useState(initial.calories != null);
  const router = useRouter();

  function handleBodyWeightChange(value: string) {
    setBodyWeight(value);
    const w = Number(value);
    if (w > 0) setProtein(estimateProteinFromBodyWeight(w).toString());
  }

  function fillCarbsAndFat(kind: "high" | "low") {
    const result = computeCarbsAndFat(Number(calories), Number(protein), kind);
    if (!result) return;
    setCarbs(result.carbsG.toString());
    setFat(result.fatG.toString());
  }

  async function handleSave() {
    setSaving(true);
    setError(null);
    const supabase = createBrowserClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) {
      setSaving(false);
      return;
    }

    const { error: saveError } = await supabase.from("daily_macros").upsert(
      {
        athlete_id: athleteId,
        group_id: groupId,
        log_date: date,
        calories: calories ? Number(calories) : null,
        protein_g: protein ? Number(protein) : null,
        carbs_g: carbs ? Number(carbs) : null,
        fat_g: fat ? Number(fat) : null,
        created_by: user.id,
      },
      { onConflict: "athlete_id,log_date" }
    );
    setSaving(false);
    if (saveError) {
      setError("Couldn't save — try again.");
      return;
    }
    if (athleteId !== user.id) {
      // Mirrors notify_on_macros_assigned (migration 0071) — same body
      // text and link_path the DB trigger already wrote to the in-app
      // notification row for this same upsert.
      const label = new Date(`${date}T00:00:00`).toLocaleDateString("en-US", { month: "short", day: "2-digit" });
      notifyPush(athleteId, "New macro targets", `Your coach set new macro targets for ${label}`, `/groups/${groupId}`);
    }
    setHasSavedEntry(true);
    router.refresh();
  }

  // A coach testing different calorie numbers before settling on a real
  // target would otherwise leave whatever they last typed as a permanent,
  // real-looking data point on this client's calorie trend graph — this
  // is the actual undo, removing the day entirely rather than leaving a
  // stray number behind.
  async function handleClear() {
    if (!window.confirm(`Clear the saved macro target for ${date}? This can't be undone.`)) return;
    setSaving(true);
    setError(null);
    const supabase = createBrowserClient();
    const { error: deleteError } = await supabase
      .from("daily_macros")
      .delete()
      .eq("athlete_id", athleteId)
      .eq("log_date", date);
    setSaving(false);
    if (deleteError) {
      setError("Couldn't clear this day — try again.");
      return;
    }
    setCalories("");
    setProtein("");
    setCarbs("");
    setFat("");
    setHasSavedEntry(false);
    router.refresh();
  }

  return (
    <div className="space-y-2">
      <div>
        <label className="font-body text-[11px] text-steel uppercase tracking-wide">
          Calories
        </label>
        <input
          type="number"
          min="0"
          value={calories}
          onChange={(e) => setCalories(e.target.value)}
          className="w-full h-9 bg-graphite border border-steel/30 text-chalk px-3 font-body text-sm mt-1 focus:outline-none focus:border-rust"
        />
      </div>

      <div>
        <label className="font-body text-[11px] text-steel uppercase tracking-wide">
          Body weight (lbs) — sets protein at {PROTEIN_G_PER_LB}g/lb
        </label>
        <input
          type="number"
          min="0"
          value={bodyWeight}
          onChange={(e) => handleBodyWeightChange(e.target.value)}
          placeholder={latestBodyWeight ? undefined : "No weight logged yet"}
          className="w-full h-9 bg-graphite border border-steel/30 text-chalk px-3 font-body text-sm mt-1 focus:outline-none focus:border-rust"
        />
      </div>

      <div className="grid grid-cols-3 gap-2">
        <div>
          <label className="font-body text-[11px] text-steel uppercase tracking-wide">
            Protein (g)
          </label>
          <input
            type="number"
            min="0"
            value={protein}
            onChange={(e) => setProtein(e.target.value)}
            className="w-full h-9 bg-graphite border border-steel/30 text-chalk px-3 font-body text-sm mt-1 focus:outline-none focus:border-rust"
          />
        </div>
        <div>
          <label className="font-body text-[11px] text-steel uppercase tracking-wide">
            Carbs (g)
          </label>
          <input
            type="number"
            min="0"
            value={carbs}
            onChange={(e) => setCarbs(e.target.value)}
            className="w-full h-9 bg-graphite border border-steel/30 text-chalk px-3 font-body text-sm mt-1 focus:outline-none focus:border-rust"
          />
        </div>
        <div>
          <label className="font-body text-[11px] text-steel uppercase tracking-wide">
            Fat (g)
          </label>
          <input
            type="number"
            min="0"
            value={fat}
            onChange={(e) => setFat(e.target.value)}
            className="w-full h-9 bg-graphite border border-steel/30 text-chalk px-3 font-body text-sm mt-1 focus:outline-none focus:border-rust"
          />
        </div>
      </div>

      <div className="flex gap-2">
        <button
          type="button"
          onClick={() => fillCarbsAndFat("high")}
          disabled={!calories || !protein}
          className="flex-1 h-8 border border-steel/30 text-steel font-body text-xs active:border-rust active:text-rust disabled:opacity-40"
        >
          High carb fill
        </button>
        <button
          type="button"
          onClick={() => fillCarbsAndFat("low")}
          disabled={!calories || !protein}
          className="flex-1 h-8 border border-steel/30 text-steel font-body text-xs active:border-rust active:text-rust disabled:opacity-40"
        >
          Low carb fill
        </button>
      </div>

      {error && <p className="font-body text-xs text-rust">{error}</p>}

      <div className="flex gap-2">
        <button
          type="button"
          onClick={handleSave}
          disabled={saving}
          className="flex-1 h-9 bg-rust text-graphite font-body text-sm font-medium disabled:opacity-40"
        >
          Save macros
        </button>
        {hasSavedEntry && (
          <button
            type="button"
            onClick={handleClear}
            disabled={saving}
            title="Remove this day's saved target entirely — use this instead of leaving a test number in place"
            className="h-9 px-3 border border-steel/30 text-steel font-body text-xs active:border-rust active:text-rust disabled:opacity-40"
          >
            Clear this day
          </button>
        )}
      </div>
    </div>
  );
}
