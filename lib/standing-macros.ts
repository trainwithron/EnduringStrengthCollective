import type { SupabaseClient } from "@supabase/supabase-js";
import type { StandingHistory, StandingRow } from "./macro-resolution";

const HISTORY_COLUMNS = "athlete_id, group_id, effective_from, calories, protein_g, carbs_g, fat_g";
const LEGACY_COLUMNS = "athlete_id, group_id, calories, protein_g, carbs_g, fat_g, updated_at";

interface HistoryDbRow {
  athlete_id: string;
  effective_from: string;
  calories: number | null;
  protein_g: number | null;
  carbs_g: number | null;
  fat_g: number | null;
}

interface LegacyDbRow {
  athlete_id: string;
  calories: number | null;
  protein_g: number | null;
  carbs_g: number | null;
  fat_g: number | null;
  updated_at: string | null;
}

function toRow(r: HistoryDbRow): StandingRow {
  return {
    effective_from: r.effective_from,
    calories: r.calories,
    protein_g: r.protein_g,
    carbs_g: r.carbs_g,
    fat_g: r.fat_g,
  };
}

// Before the history table exists, the single row in client_macro_targets stands in as a one-entry
// history that took effect the day it was saved.
function legacyToRow(r: LegacyDbRow): StandingRow {
  return {
    effective_from: r.updated_at ? r.updated_at.slice(0, 10) : "1970-01-01",
    calories: r.calories,
    protein_g: r.protein_g,
    carbs_g: r.carbs_g,
    fat_g: r.fat_g,
  };
}

// Standing-target histories for several athletes at once. Scoped to a group when one is given, because the
// same person can be a client in more than one group. A failed lookup (or a deployment where the table
// isn't there yet) must never break a page that only wanted to show a macro target: it just means "no
// standing target", which is how every page behaved before.
export async function fetchStandingHistories(
  supabase: SupabaseClient,
  athleteIds: string[],
  groupId?: string
): Promise<Map<string, StandingHistory>> {
  const out = new Map<string, StandingHistory>();
  if (athleteIds.length === 0) return out;

  let query = supabase
    .from("client_macro_target_history")
    .select(HISTORY_COLUMNS)
    .in("athlete_id", athleteIds)
    .order("effective_from", { ascending: true });
  if (groupId) query = query.eq("group_id", groupId);
  const { data, error } = await query;

  if (!error && data) {
    for (const r of data as unknown as HistoryDbRow[]) {
      const list = out.get(r.athlete_id) ?? [];
      list.push(toRow(r));
      out.set(r.athlete_id, list);
    }
    // The history table exists. If it holds nothing for an athlete yet, a legacy single row (saved before the
    // history table, and not yet copied across) still counts.
    const missing = athleteIds.filter((id) => !out.has(id));
    if (missing.length === 0) return out;
    athleteIds = missing;
  }

  let legacy = supabase.from("client_macro_targets").select(LEGACY_COLUMNS).in("athlete_id", athleteIds);
  if (groupId) legacy = legacy.eq("group_id", groupId);
  const { data: legacyData, error: legacyError } = await legacy;
  if (!legacyError && legacyData) {
    for (const r of legacyData as unknown as LegacyDbRow[]) {
      if (!out.has(r.athlete_id)) out.set(r.athlete_id, [legacyToRow(r)]);
    }
  }
  return out;
}

export async function fetchStandingHistory(
  supabase: SupabaseClient,
  athleteId: string,
  groupId?: string
): Promise<StandingHistory> {
  const map = await fetchStandingHistories(supabase, [athleteId], groupId);
  return map.get(athleteId) ?? [];
}

export interface StandingTargetInput {
  calories: number | null;
  proteinG: number | null;
  carbsG: number | null;
  fatG: number | null;
}

// Saves a new standing target from `today` (the day it starts, the coach's own calendar day, or a later one the coach chose) onward, or, with `null`, removes
// it from then on. Past days keep what they showed: each save is a new dated row, saving twice on the same day just replaces that day's row, and any row dated
// AFTER `today` is removed (the newer decision wins). Falls back to the single-row table where the history table
// hasn't been created yet, so saving still works either way.
export async function saveStandingTarget(
  supabase: SupabaseClient,
  args: { athleteId: string; groupId: string; userId: string | null; target: StandingTargetInput | null; today: string }
): Promise<{ ok: true } | { ok: false }> {
  const { athleteId, groupId, userId, target, today } = args;
  const values = {
    calories: target?.calories ?? null,
    protein_g: target?.proteinG ?? null,
    carbs_g: target?.carbsG ?? null,
    fat_g: target?.fatG ?? null,
  };

  const { error } = await supabase.from("client_macro_target_history").upsert(
    { athlete_id: athleteId, group_id: groupId, effective_from: today, ...values, created_by: userId },
    { onConflict: "athlete_id,group_id,effective_from" }
  );
  if (!error) {
    // A row scheduled for a LATER date would take over again on that date and silently undo this newer decision, so it is removed in the same step. If that
    // cleanup fails the save is reported as failed (the coach retries), never as done with an old row still waiting.
    const { error: clearError } = await supabase
      .from("client_macro_target_history")
      .delete()
      .eq("athlete_id", athleteId)
      .eq("group_id", groupId)
      .gt("effective_from", today);
    return clearError ? { ok: false } : { ok: true };
  }

  // Only a missing history table falls back to the old single row; any other failure (a denied write,
  // a dropped connection) is a real failure and must not quietly write somewhere else.
  const missingTable = /does not exist|schema cache|PGRST205|42P01/i.test(`${error.message} ${error.code ?? ""}`);
  if (!missingTable) return { ok: false };

  // History table not there yet: keep the old single-row behaviour.
  if (target) {
    const { error: legacyError } = await supabase.from("client_macro_targets").upsert(
      { athlete_id: athleteId, group_id: groupId, ...values, updated_by: userId, updated_at: new Date().toISOString() },
      { onConflict: "athlete_id" }
    );
    return legacyError ? { ok: false } : { ok: true };
  }
  const { error: deleteError } = await supabase.from("client_macro_targets").delete().eq("athlete_id", athleteId);
  return deleteError ? { ok: false } : { ok: true };
}
