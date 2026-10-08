import type { SupabaseClient } from "@supabase/supabase-js";
import type { NutritionPhase } from "@/lib/nutrition-checkin";
import type { PhasePlan } from "@/lib/phase-plan";
import { savePhasePlan } from "@/lib/phase-plan-write";

// "Move to the planned phase" (Ron: clients do not need to confirm phases; they only need to know a new block has started). The coach's choice sets the phase of record at once: the plan
// takes the new phase from today, the review date and the planned next phase are cleared (the plan has been carried out), and the milestone tag follows. No goal is created and nothing is
// asked of the client. The coach still approves the new calories (the starting-target suggestion is made separately and applied as always).
export async function switchToPlannedPhase(
  supabase: SupabaseClient,
  args: { athleteId: string; groupId: string; coachId: string; phase: NutritionPhase; todayKey: string; existing: PhasePlan | null }
): Promise<{ ok: boolean }> {
  return savePhasePlan(supabase, { ...args, reviewOn: null, plannedNextPhase: null });
}

// The one plain line the client is told, with no phase words in it.
export const NEW_BLOCK_NOTICE = { title: "A new training block", body: "Your coach started a new training block with you." } as const;
