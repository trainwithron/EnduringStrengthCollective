import type { SupabaseClient } from "@supabase/supabase-js";
import { asWeightUnit, type WeightUnit } from "@/lib/units";

// The unit a person lifts in (their About you setting). Any problem reading it means pounds, the stored unit.
export async function loadLiftUnit(supabase: SupabaseClient, athleteId: string): Promise<WeightUnit> {
  try {
    const { data, error } = await supabase.from("athlete_profile_details").select("weight_unit").eq("athlete_id", athleteId).maybeSingle();
    if (error) return "lb";
    return asWeightUnit((data as { weight_unit?: string | null } | null)?.weight_unit);
  } catch {
    return "lb";
  }
}
