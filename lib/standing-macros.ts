import type { SupabaseClient } from "@supabase/supabase-js";
import type { StandingWithDate } from "./macro-resolution";

const COLUMNS = "athlete_id, calories, protein_g, carbs_g, fat_g, updated_at";

// A lookup failure (or a deployment where the table isn't there yet) must
// never break a page that only wanted to show a macro target: it just means
// "no standing target", which is exactly how every page behaved before.
export async function fetchStandingTarget(
  supabase: SupabaseClient,
  athleteId: string
): Promise<StandingWithDate | null> {
  const { data, error } = await supabase
    .from("client_macro_targets")
    .select(COLUMNS)
    .eq("athlete_id", athleteId)
    .maybeSingle();
  if (error || !data) return null;
  return data as StandingWithDate;
}

export async function fetchStandingTargets(
  supabase: SupabaseClient,
  athleteIds: string[]
): Promise<Map<string, StandingWithDate>> {
  const out = new Map<string, StandingWithDate>();
  if (athleteIds.length === 0) return out;
  const { data, error } = await supabase
    .from("client_macro_targets")
    .select(COLUMNS)
    .in("athlete_id", athleteIds);
  if (error || !data) return out;
  for (const row of data as (StandingWithDate & { athlete_id: string })[]) {
    out.set(row.athlete_id, row);
  }
  return out;
}
