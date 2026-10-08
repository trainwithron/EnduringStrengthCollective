import type { SupabaseClient } from "@supabase/supabase-js";
import type { NutritionPhase } from "@/lib/nutrition-checkin";
import type { PhasePlan } from "@/lib/phase-plan";

// "Move to the planned phase" goes through the goals flow the app already has: the coach SUGGESTS a goal that carries the phase, and the client confirms it, changes it or declines it. The
// phase of record changes only when the client confirms (a database trigger does that; this file never writes the plan). Nothing here sends a message.

export const PHASE_GOAL_LABEL: Record<NutritionPhase, string> = {
  reverse_diet: "Rebuild: reverse diet",
  maintenance: "Next step: maintenance",
  hypertrophy: "Next step: build muscle",
  fat_loss: "Next step: keep fat loss going",
};

export async function proposePhaseMove(
  supabase: SupabaseClient,
  args: { athleteId: string; groupId: string; coachId: string; phase: NutritionPhase }
): Promise<{ ok: true; already: boolean } | { ok: false }> {
  const { athleteId, groupId, coachId, phase } = args;
  // One open suggestion per phase: asking twice does not stack goals in front of the client.
  const { data: open, error: readError } = await supabase
    .from("client_goals")
    .select("id")
    .eq("athlete_id", athleteId)
    .eq("group_id", groupId)
    .eq("status", "proposed")
    .eq("created_by", coachId)
    .eq("nutrition_phase", phase)
    .limit(1);
  if (readError) return { ok: false };
  if (open && open.length > 0) return { ok: true, already: true };
  const { error } = await supabase.from("client_goals").insert({
    athlete_id: athleteId,
    group_id: groupId,
    goal_type: "custom",
    custom_label: PHASE_GOAL_LABEL[phase],
    nutrition_phase: phase,
    created_by: coachId,
  });
  return error ? { ok: false } : { ok: true, already: false };
}

export interface PhaseGoalRow {
  status: string;
  created_by: string | null;
  athlete_id: string;
  nutrition_phase?: string | null;
  created_at?: string | null;
}

// Where the coach's suggestion of the planned phase stands, from the client's goals: waiting for the client, or declined since this phase began. A goal the client wrote themself is never
// counted (it cannot carry a phase), and a suggestion from before this phase began is old news.
export function moveState(goals: PhaseGoalRow[], plan: PhasePlan): "none" | "waiting" | "declined" {
  const next = plan.plannedNextPhase;
  if (!next) return "none";
  const mine = goals
    .filter((g) => g.nutrition_phase === next && g.created_by != null && g.created_by !== g.athlete_id && String(g.created_at ?? "").slice(0, 10) >= plan.startedOn)
    .sort((a, b) => String(b.created_at ?? "").localeCompare(String(a.created_at ?? "")));
  const newest = mine[0];
  if (!newest) return "none";
  if (newest.status === "proposed") return "waiting";
  if (newest.status === "declined") return "declined";
  return "none";
}
