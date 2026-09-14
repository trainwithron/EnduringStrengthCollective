"use client";

import { useState } from "react";
import { createBrowserClient } from "@/lib/supabase/client";
import type { RecentFoodLogOption } from "@/lib/recent-food-logs";
import type { FoodLogEntry } from "./meal-checkoff-list";

// One-tap re-log of a real past entry — no retyping, no AI call, no
// wait. Directly targets the #1 friction cause (calorie_tracking_ux_
// research_and_plan.md V2 #2) since a repeat meal is the common case.
export function RecentFoodChips({
  athleteId,
  groupId,
  logDate,
  recents,
  onLogged,
}: {
  athleteId: string;
  groupId: string;
  logDate: string;
  recents: RecentFoodLogOption[];
  onLogged: (entry: FoodLogEntry) => void;
}) {
  const [loggingKey, setLoggingKey] = useState<string | null>(null);

  if (recents.length === 0) return null;

  async function handleTap(option: RecentFoodLogOption) {
    setLoggingKey(option.description);
    const supabase = createBrowserClient();
    const { data } = await supabase
      .from("food_log_entries")
      .insert({
        athlete_id: athleteId,
        group_id: groupId,
        log_date: logDate,
        meal_slot: null,
        status: "quick_log",
        description: option.description,
        calories: option.calories,
        protein_g: option.proteinG,
        carbs_g: option.carbsG,
        fat_g: option.fatG,
      })
      .select("id")
      .single();
    setLoggingKey(null);
    if (data) {
      onLogged({
        id: data.id,
        mealSlot: null,
        status: "quick_log",
        description: option.description,
        calories: option.calories,
        proteinG: option.proteinG,
        carbsG: option.carbsG,
        fatG: option.fatG,
      });
    }
  }

  return (
    <div className="mb-2">
      <p className="font-body text-[10px] text-steel uppercase tracking-wide mb-1.5">Recent</p>
      <div className="flex flex-wrap gap-1.5">
        {recents.map((r) => (
          <button
            key={r.description}
            type="button"
            onClick={() => handleTap(r)}
            disabled={loggingKey === r.description}
            className="h-8 px-2.5 border border-steel/30 text-chalk font-body text-xs active:border-rust active:text-rust transition-colors disabled:opacity-40"
          >
            {loggingKey === r.description ? "Logging…" : r.description}
          </button>
        ))}
      </div>
    </div>
  );
}
