"use client";

import { useState } from "react";
import { createBrowserClient } from "@/lib/supabase/client";
import type { RecentFoodLogOption } from "@/lib/recent-food-logs";
import type { FoodLogEntry } from "./meal-checkoff-list";
import { copyRows, defaultMealSlot, insertCopies } from "@/lib/food-entry";

// One-tap re-log of a real past entry — no retyping, no AI call, no
// wait. Directly targets the #1 friction cause (calorie_tracking_ux_
// research_and_plan.md V2 #2) since a repeat meal is the common case.
// The whole food is logged again (its serving, amount and nutrients), into the meal for the time of day.
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
  const [error, setError] = useState<string | null>(null);

  if (recents.length === 0) return null;

  async function handleTap(option: RecentFoodLogOption) {
    setLoggingKey(option.key);
    setError(null);
    const now = new Date();
    const added = await insertCopies(
      createBrowserClient(),
      copyRows([option.entry], { athleteId, groupId, toDate: logDate, mealSlot: defaultMealSlot(now.getHours(), now.getMinutes()) })
    );
    setLoggingKey(null);
    if (!added || added.length === 0) {
      setError("That didn't log. Try again.");
      return;
    }
    onLogged(added[0]);
  }

  return (
    <div>
      <p className="font-body text-xs text-steel uppercase tracking-wide mb-1.5">Recent</p>
      <div className="flex flex-wrap gap-1.5">
        {recents.map((r) => (
          <button
            key={r.key}
            type="button"
            onClick={() => handleTap(r)}
            disabled={loggingKey === r.key}
            className="min-h-11 px-2.5 py-1 border border-steel/30 text-chalk font-body text-xs text-left active:border-rust active:text-rust transition-colors disabled:opacity-40"
          >
            {loggingKey === r.key ? "Logging…" : r.label}
          </button>
        ))}
      </div>
      {error && (
        <p className="font-body text-xs text-rust mt-1" role="alert">
          {error}
        </p>
      )}
    </div>
  );
}
