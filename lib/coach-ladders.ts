import type { SupabaseClient } from "@supabase/supabase-js";
import type { LadderEntry } from "@/lib/make-template";
import type { SlotTier } from "@/lib/slot-templates";
import { addStarterLadders } from "@/lib/starter-ladders-add";

// The movement-pattern ladders a coach works from are their OWN (every screen reads the coach's own patterns; the starter set is copied into them by "Add the starter ladders", lib/starter-ladders.ts).
// Make a template reads them, and for a coach who has none yet adds the starter ladders first, in the same click (Ron: defaults are made for him, never another setup step).

interface RungRow {
  exercise_name: string;
  tier: string | null;
  is_unilateral: boolean | null;
  movement_pattern_id: string;
  movement_patterns?: { name?: string | null } | null;
}

export function toLadderEntries(rows: RungRow[]): LadderEntry[] {
  return rows.map((r) => ({
    exerciseName: r.exercise_name,
    patternId: r.movement_pattern_id,
    patternName: r.movement_patterns?.name ?? "Pattern",
    tier: (r.tier as SlotTier | null) ?? null,
    unilateral: r.is_unilateral === true,
  }));
}

async function readOwnLadders(supabase: SupabaseClient, coachId: string): Promise<LadderEntry[] | null> {
  const { data, error } = await supabase
    .from("movement_pattern_exercises")
    .select("exercise_name, tier, is_unilateral, movement_pattern_id, movement_patterns!inner ( name, created_by )")
    .eq("movement_patterns.created_by", coachId);
  return error ? null : toLadderEntries((data ?? []) as RungRow[]);
}

// The coach's own ladders; with none, the starter ladders are added first. `addedStarters` says so (the summary tells the coach). A failed read is said, never read as "no ladders".
export async function loadCoachLadders(supabase: SupabaseClient, coachId: string): Promise<{ ladders: LadderEntry[]; addedStarters: boolean } | { error: true }> {
  const own = await readOwnLadders(supabase, coachId);
  if (own === null) return { error: true };
  if (own.length > 0) return { ladders: own, addedStarters: false };
  const added = await addStarterLadders(supabase, coachId);
  if (!added.ok) return { error: true };
  const after = await readOwnLadders(supabase, coachId);
  return after === null ? { error: true } : { ladders: after, addedStarters: true };
}
