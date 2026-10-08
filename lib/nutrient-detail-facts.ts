import type { SupabaseClient } from "@supabase/supabase-js";
import { fetchAgeAndSex, fetchFoodRules, fetchNutrientLog } from "@/lib/nutrient-data";
import { buildDetail, completenessLine } from "@/lib/nutrient-view";
import { dayTotals } from "@/lib/nutrient-day";
import type { NutrientDetailFacts } from "@/components/nutrition/nutrient-detail-view";

// Everything one nutrient's detail needs, read with the signed-in person's own access (a client reads their own; a coach reads their clients' through the existing rules). Used by the
// nutrient's own page and by the route the panel over the food log asks, so both show the same facts. Null when the key is not a known nutrient.
export async function loadNutrientDetailFacts(
  supabase: SupabaseClient,
  args: { athleteId: string; key: string; todayKey: string; audience: "client" | "coach"; clientName: string | null }
): Promise<NutrientDetailFacts | null> {
  const { athleteId, key, todayKey, audience, clientName } = args;
  const [{ entries, truncated }, { age, sex }, rules] = await Promise.all([fetchNutrientLog(supabase, athleteId, todayKey), fetchAgeAndSex(supabase, athleteId, todayKey), fetchFoodRules(supabase, athleteId)]);
  const detail = buildDetail({ key, entries, todayKey, age, sex, rules });
  if (!detail) return null;
  const today = dayTotals(todayKey, entries, [key]);
  return {
    detail,
    audience,
    who: audience === "coach" ? clientName ?? "this client" : "you",
    todayEntries: today.entries,
    completeness: completenessLine(today.byKey[key].coveragePct, today.entries),
    truncated,
  };
}
