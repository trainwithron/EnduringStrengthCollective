import type { SupabaseClient } from "@supabase/supabase-js";
import type { NutritionPhase } from "@/lib/nutrition-checkin";
import { phaseToMilestoneTag, type PhasePlan } from "@/lib/phase-plan";

// The coach's writes to the phase of record. Setting the phase also writes the milestone tag the trend detectors read (cut, bulk, reverse diet; maintenance clears it),
// so the two can never disagree. A change of the review date or the planned next phase alone never touches the tag or the start date.

async function writeTag(supabase: SupabaseClient, args: { athleteId: string; groupId: string; coachId: string; phase: NutritionPhase; todayKey: string }): Promise<boolean> {
  const tag = phaseToMilestoneTag(args.phase);
  if (!tag) {
    const { error } = await supabase.from("nutrition_phases").delete().eq("athlete_id", args.athleteId).eq("group_id", args.groupId);
    return !error;
  }
  const { error } = await supabase
    .from("nutrition_phases")
    .upsert({ athlete_id: args.athleteId, group_id: args.groupId, phase: tag, started_at: args.todayKey, created_by: args.coachId }, { onConflict: "athlete_id,group_id" });
  return !error;
}

export async function savePhasePlan(
  supabase: SupabaseClient,
  args: {
    athleteId: string;
    groupId: string;
    coachId: string;
    phase: NutritionPhase;
    reviewOn: string | null;
    plannedNextPhase: NutritionPhase | null;
    todayKey: string;
    existing: PhasePlan | null;
  }
): Promise<{ ok: boolean }> {
  const changed = !args.existing || args.existing.phase !== args.phase;
  const { error } = await supabase.from("client_phase_plans").upsert(
    {
      athlete_id: args.athleteId,
      group_id: args.groupId,
      phase: args.phase,
      started_on: changed ? args.todayKey : args.existing!.startedOn,
      review_on: args.reviewOn,
      planned_next_phase: args.plannedNextPhase,
      updated_by: args.coachId,
      updated_at: new Date().toISOString(),
    },
    { onConflict: "athlete_id,group_id" }
  );
  if (error) return { ok: false };
  if (changed) return { ok: await writeTag(supabase, args) };
  return { ok: true };
}

// Used when a starting target is applied: a client with no phase of record gets the one the target was worked out for. A client who already has one keeps it.
export async function ensurePhasePlan(
  supabase: SupabaseClient,
  args: { athleteId: string; groupId: string; coachId: string; phase: NutritionPhase; todayKey: string }
): Promise<{ ok: boolean; created: boolean }> {
  const { data: existing, error: readError } = await supabase.from("client_phase_plans").select("phase").eq("athlete_id", args.athleteId).eq("group_id", args.groupId).maybeSingle();
  if (readError) return { ok: false, created: false };
  if (existing) return { ok: true, created: false };
  const { error } = await supabase
    .from("client_phase_plans")
    .upsert(
      { athlete_id: args.athleteId, group_id: args.groupId, phase: args.phase, started_on: args.todayKey, updated_by: args.coachId, updated_at: new Date().toISOString() },
      { onConflict: "athlete_id,group_id", ignoreDuplicates: true }
    );
  if (error) return { ok: false, created: false };
  return { ok: await writeTag(supabase, args), created: true };
}
