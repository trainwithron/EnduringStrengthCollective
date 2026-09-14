// V2 #2 from calorie_tracking_ux_research_and_plan.md — "Recents for
// quick-log," cheap, no new schema: reuse of an athlete's own past
// food_log_entries. Targets the #1 friction cause (typing + waiting on
// an AI estimate) directly by skipping both for a repeat entry.

export interface RecentFoodLogRow {
  description: string;
  calories: number | null;
  proteinG: number | null;
  carbsG: number | null;
  fatG: number | null;
  createdAt: string;
}

export interface RecentFoodLogOption {
  description: string;
  calories: number | null;
  proteinG: number | null;
  carbsG: number | null;
  fatG: number | null;
}

// rows must already be ordered most-recent-first. Keeps only the most
// recent instance of each distinct description, case/whitespace-
// insensitively (so "Chipotle bowl" and "chipotle bowl " don't both
// show up as separate chips), capped at `limit`.
export function dedupeRecentFoodLogs(rows: RecentFoodLogRow[], limit: number): RecentFoodLogOption[] {
  const seen = new Set<string>();
  const result: RecentFoodLogOption[] = [];
  for (const row of rows) {
    if (!row.description) continue;
    const key = row.description.trim().toLowerCase();
    if (!key || seen.has(key)) continue;
    seen.add(key);
    result.push({
      description: row.description,
      calories: row.calories,
      proteinG: row.proteinG,
      carbsG: row.carbsG,
      fatG: row.fatG,
    });
    if (result.length >= limit) break;
  }
  return result;
}
