"use client";

import { useState } from "react";
import { createBrowserClient } from "@/lib/supabase/client";
import type { RecentFoodLogOption } from "@/lib/recent-food-logs";
import type { FoodLogEntry } from "./meal-checkoff-list";
import { insertFoodLogEntry } from "@/lib/food-log-insert";

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
    const entry = await insertFoodLogEntry(createBrowserClient(), {
      athleteId,
      groupId,
      logDate,
      description: option.description,
      calories: option.calories,
      proteinG: option.proteinG,
      carbsG: option.carbsG,
      fatG: option.fatG,
    });
    setLoggingKey(null);
    if (entry) onLogged(entry);
  }

  return (
    <div className="mb-2">
      <p className="font-body text-xs text-steel uppercase tracking-wide mb-1.5">Recent</p>
      <div className="flex flex-wrap gap-1.5">
        {recents.map((r) => (
          <button
            key={r.description}
            type="button"
            onClick={() => handleTap(r)}
            disabled={loggingKey === r.description}
            className="h-11 px-2.5 border border-steel/30 text-chalk font-body text-xs active:border-rust active:text-rust transition-colors disabled:opacity-40"
          >
            {loggingKey === r.description ? "Logging…" : r.description}
          </button>
        ))}
      </div>
    </div>
  );
}
