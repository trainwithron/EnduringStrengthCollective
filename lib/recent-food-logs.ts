// V2 #2 from calorie_tracking_ux_research_and_plan.md — "Recents for
// quick-log," cheap, no new schema: reuse of an athlete's own past
// food_log_entries. Targets the #1 friction cause (typing + waiting on
// an AI estimate) directly by skipping both for a repeat entry.
//
// A recent keeps the WHOLE logged food (its serving, its amount and every nutrient), so one tap logs exactly that food again (FIX_NUTRITION_PHONE item 4).

import type { FoodLogEntry } from "@/components/athlete/meal-checkoff-list";
import { servingText } from "@/lib/food-serving";

export interface RecentFoodLogOption {
  // The description, case- and space-insensitive: one chip per food.
  key: string;
  // What the chip says: the food and, when it was logged with one, its serving ("Greek yogurt · 1 x cup (227 g)").
  label: string;
  entry: FoodLogEntry;
}

export const RECENT_FOODS_LIMIT = 8;

// `entries` must already be newest first. Keeps only the newest of each description (so "Chipotle bowl" and "chipotle bowl " are one chip), capped at `limit`.
export function dedupeRecentFoodLogs(entries: FoodLogEntry[], limit: number = RECENT_FOODS_LIMIT): RecentFoodLogOption[] {
  const seen = new Set<string>();
  const result: RecentFoodLogOption[] = [];
  for (const entry of entries) {
    if (entry.status === "skipped" || !entry.description) continue;
    const key = entry.description.trim().toLowerCase();
    if (!key || seen.has(key)) continue;
    seen.add(key);
    const serving = servingText({ servingLabel: entry.servingLabel ?? null, servingQty: entry.servingQty ?? null, amountG: entry.amountG ?? null });
    result.push({ key, label: serving ? `${entry.description} · ${serving}` : entry.description, entry });
    if (result.length >= limit) break;
  }
  return result;
}

// Foods logged on this page go to the front (newest first), then the saved recents; still one chip per food, at most `limit`.
export function withJustLogged(justLogged: FoodLogEntry[], recents: RecentFoodLogOption[], limit: number = RECENT_FOODS_LIMIT): RecentFoodLogOption[] {
  return dedupeRecentFoodLogs([...[...justLogged].reverse(), ...recents.map((r) => r.entry)], limit);
}
