import type { SupabaseClient } from "@supabase/supabase-js";
import { pageAll } from "@/lib/page-all";
import { chunkByDay, type ImportedFoodRow } from "@/lib/nutrition-history-import";
import { IMPORTED_FOOD_SOURCE } from "@/lib/imported-food";

// Saving a coach's upload of a client's food history (app/api/clients/nutrition-history). The caller has already checked the coach and the client; this only writes.
//
// The rule that keeps an upload from ever doubling: a DAY is all or nothing. A day that already has imported food for this client in this group is left exactly as it is,
// whatever file it came from, and a day is only ever written whole (one insert holds whole days, and an insert either saves every row or none). So uploading the same file again,
// or a file that overlaps an earlier one, or pressing Save again after a failure, adds only the days that are not there yet.
//
// Health data: nothing about a row (no food, no number) is ever logged. A failure is logged by its database code only.

export const INSERT_BATCH_ROWS = 500;
// The most rows one request may carry (the page sends a file in pieces of whole days, each under this).
export const REQUEST_MAX_ROWS = 2000;

export type SaveImportResult =
  | { ok: true; savedDays: number; savedRows: number; alreadyImportedDays: number; leftOutDays: number }
  | { ok: false; status: number; error: string; savedDays: number; savedRows: number };

export const NOT_SWITCHED_ON =
  "Uploading nutrition history isn't switched on yet (a database step is waiting). Nothing was saved.";

const days = (rows: ImportedFoodRow[]) => new Set(rows.map((r) => r.date)).size;

export function insertRowOf(row: ImportedFoodRow, ids: { athleteId: string; groupId: string }) {
  return {
    athlete_id: ids.athleteId,
    group_id: ids.groupId,
    log_date: row.date,
    meal_slot: row.mealSlot,
    status: "quick_log" as const,
    description: row.description,
    serving_label: row.servingLabel,
    calories: row.calories,
    protein_g: row.proteinG,
    carbs_g: row.carbsG,
    fat_g: row.fatG,
    food_source: IMPORTED_FOOD_SOURCE,
  };
}

export async function saveImportedHistory(
  db: SupabaseClient,
  args: { athleteId: string; groupId: string; rows: ImportedFoodRow[]; todayKey: string }
): Promise<SaveImportResult> {
  // Today and later are logged live in the app, never brought in (the page leaves them out too; the client's day here is the coach's business day).
  const past = args.rows.filter((r) => r.date < args.todayKey);
  const leftOutDays = days(args.rows.filter((r) => r.date >= args.todayKey));
  if (past.length === 0) return { ok: true, savedDays: 0, savedRows: 0, alreadyImportedDays: 0, leftOutDays };

  const sorted = [...past].sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
  const first = sorted[0].date;
  const last = sorted[sorted.length - 1].date;

  // The days in this range that already have imported food for this client in this group.
  const existing = await pageAll(
    (from, to) =>
      db
        .from("food_log_entries")
        .select("id, log_date")
        .eq("athlete_id", args.athleteId)
        .eq("group_id", args.groupId)
        .eq("food_source", IMPORTED_FOOD_SOURCE)
        .gte("log_date", first)
        .lte("log_date", last)
        .order("id")
        .range(from, to),
    { maxPages: 40 }
  );
  if (existing.failed || existing.truncated) {
    return { ok: false, status: 500, error: "Couldn't check which days are already imported. Nothing was saved. Try again.", savedDays: 0, savedRows: 0 };
  }
  const taken = new Set((existing.rows as { log_date: string }[]).map((r) => String(r.log_date).slice(0, 10)));
  const fresh = sorted.filter((r) => !taken.has(r.date));
  const alreadyImportedDays = days(sorted.filter((r) => taken.has(r.date)));

  let savedDays = 0;
  let savedRows = 0;
  for (const batch of chunkByDay(fresh, INSERT_BATCH_ROWS)) {
    const { error } = await db.from("food_log_entries").insert(batch.map((r) => insertRowOf(r, args)));
    if (error) {
      const code = (error as { code?: string }).code ?? "unknown";
      console.error(`[nutrition-history] an insert failed (code ${code})`);
      // The database refusing the import mark: the paste (migration 0446) is not applied yet.
      if (code === "23514" && savedRows === 0) return { ok: false, status: 503, error: NOT_SWITCHED_ON, savedDays, savedRows };
      return { ok: false, status: 500, error: "Something went wrong while saving.", savedDays, savedRows };
    }
    savedDays += days(batch);
    savedRows += batch.length;
  }
  return { ok: true, savedDays, savedRows, alreadyImportedDays, leftOutDays };
}

// Taking back every imported food for this client in this group (a file put on the wrong client, or the wrong file). Food the client logged in the app is never touched.
export async function removeImportedHistory(db: SupabaseClient, args: { athleteId: string; groupId: string }): Promise<{ ok: true; removed: number } | { ok: false; error: string }> {
  const { error, count } = await db
    .from("food_log_entries")
    .delete({ count: "exact" })
    .eq("athlete_id", args.athleteId)
    .eq("group_id", args.groupId)
    .eq("food_source", IMPORTED_FOOD_SOURCE);
  if (error) {
    console.error(`[nutrition-history] removing failed (code ${(error as { code?: string }).code ?? "unknown"})`);
    return { ok: false, error: "Couldn't remove the imported history. Try again." };
  }
  return { ok: true, removed: count ?? 0 };
}
