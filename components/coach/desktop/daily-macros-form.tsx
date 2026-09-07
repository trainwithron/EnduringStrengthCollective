"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { createBrowserClient } from "@/lib/supabase/client";

export function DailyMacrosForm({
  athleteId,
  groupId,
  date,
  initial,
}: {
  athleteId: string;
  groupId: string;
  date: string; // "YYYY-MM-DD"
  initial: { calories: number | null; proteinG: number | null; carbsG: number | null; fatG: number | null };
}) {
  const [calories, setCalories] = useState(initial.calories?.toString() ?? "");
  const [protein, setProtein] = useState(initial.proteinG?.toString() ?? "");
  const [carbs, setCarbs] = useState(initial.carbsG?.toString() ?? "");
  const [fat, setFat] = useState(initial.fatG?.toString() ?? "");
  const [saving, setSaving] = useState(false);
  const router = useRouter();

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
      <div className="grid grid-cols-2 gap-2">
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
