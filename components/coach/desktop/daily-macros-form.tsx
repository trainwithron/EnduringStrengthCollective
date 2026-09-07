"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { createBrowserClient } from "@/lib/supabase/client";

// Standard coaching rules of thumb — a starting point the coach can
// always overwrite by hand afterward, not a locked formula.
const PROTEIN_G_PER_LB = 1;
const CARB_SPLIT = { high: { carb: 0.7, fat: 0.3 }, low: { carb: 0.3, fat: 0.7 } };

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
  const router = useRouter();

  function handleBodyWeightChange(value: string) {
    setBodyWeight(value);
    const w = Number(value);
    if (w > 0) setProtein(Math.round(w * PROTEIN_G_PER_LB).toString());
  }

  function fillCarbsAndFat(kind: "high" | "low") {
    const cal = Number(calories);
    const pro = Number(protein);
    if (!cal || !pro) return;
    const remaining = cal - pro * 4;
    if (remaining <= 0) return;
    const split = CARB_SPLIT[kind];
    setCarbs(Math.round((remaining * split.carb) / 4).toString());
    setFat(Math.round((remaining * split.fat) / 9).toString());
  }

  async function handleSave() {
    setSaving(true);
    const supabase = createBrowserClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) {
      setSaving(false);
      return;
    }

    await supabase.from("daily_macros").upsert(
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

      <button
        type="button"
        onClick={handleSave}
        disabled={saving}
        className="w-full h-9 bg-rust text-graphite font-body text-sm font-medium disabled:opacity-40"
      >
        Save macros
      </button>
    </div>
  );
}
