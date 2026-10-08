import type { SupabaseClient } from "@supabase/supabase-js";
import type { BaselineResult } from "@/lib/nutrition-baseline";

// A starting target worked out from the client's own numbers, saved as an ordinary PENDING suggestion the coach reviews and applies like any other. Nothing applies by itself.
export async function createBaselineSuggestion(
  supabase: SupabaseClient,
  args: { athleteId: string; groupId: string; outcome: BaselineResult; archetype: "standard" | "keto" | "carnivore" }
): Promise<{ ok: boolean }> {
  const { athleteId, groupId, outcome, archetype } = args;
  const { error } = await supabase.from("nutrition_checkin_suggestions").insert({
    athlete_id: athleteId,
    group_id: groupId,
    phase: outcome.phase,
    new_calories: outcome.calories,
    rationale: outcome.rationale,
    protein_g: outcome.proteinG,
    carbs_g: outcome.carbsG,
    fat_g: outcome.fatG,
    diet_archetype: archetype,
    dietary_restrictions: "",
    status: "pending",
    kind: "baseline",
    below_floor: outcome.belowFloor,
    consecutive_surplus_spikes: 0,
  });
  return { ok: !error };
}

// A suggestion left waiting from an OLD phase must not be applied after the phase has moved (a starting target or a weekly calorie change would put the client's calories on the old
// phase's number). Dismisses every pending suggestion of either kind for this client in this group whose phase is not the new one, the way the suggestion card's own Dismiss does. A
// pending one that already matches the new phase is kept.
export async function dismissPendingBaselines(supabase: SupabaseClient, args: { athleteId: string; groupId: string; newPhase: string }): Promise<{ ok: boolean }> {
  const { error } = await supabase.from("nutrition_checkin_suggestions").update({ status: "dismissed" }).eq("athlete_id", args.athleteId).eq("group_id", args.groupId).eq("status", "pending").neq("phase", args.newPhase);
  return { ok: !error };
}
