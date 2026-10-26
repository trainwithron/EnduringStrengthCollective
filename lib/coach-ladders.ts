import type { SupabaseClient } from "@supabase/supabase-js";
import type { LadderEntry } from "@/lib/make-template";
import type { SlotTier } from "@/lib/slot-templates";

// The movement-pattern ladders a coach works from: their own patterns, and the starter set every coach starts with (the 14 patterns and their rungs seeded under the starter owner, migration 0161).
// When the coach has a pattern of their own with the same name as a starter one, theirs is used and the starter one is left out. Another coach's own patterns are never used.
export const STARTER_LADDER_OWNER = "11111111-1111-1111-1111-111111111111";

interface PatternRow {
  id: string;
  name: string;
  created_by: string;
}
interface RungRow {
  movement_pattern_id: string;
  exercise_name: string;
  tier: string | null;
  is_unilateral: boolean | null;
}

// Pure: which patterns count (own first, a starter one only when the coach has none by that name), and their rungs as ladder entries.
export function coachLadders(coachId: string, patterns: PatternRow[], rungs: RungRow[]): LadderEntry[] {
  const own = patterns.filter((p) => p.created_by === coachId);
  const ownNames = new Set(own.map((p) => p.name.trim().toLowerCase()));
  const starters = patterns.filter((p) => p.created_by === STARTER_LADDER_OWNER && p.created_by !== coachId && !ownNames.has(p.name.trim().toLowerCase()));
  const used = new Map([...own, ...starters].map((p) => [p.id, p]));
  return rungs
    .filter((r) => used.has(r.movement_pattern_id))
    .map((r) => ({
      exerciseName: r.exercise_name,
      patternId: r.movement_pattern_id,
      patternName: used.get(r.movement_pattern_id)!.name,
      tier: (r.tier as SlotTier | null) ?? null,
      unilateral: r.is_unilateral === true,
    }));
}

export async function loadCoachLadders(supabase: SupabaseClient, coachId: string): Promise<{ ladders: LadderEntry[] } | { error: true }> {
  const { data: patterns, error } = await supabase.from("movement_patterns").select("id, name, created_by").in("created_by", [coachId, STARTER_LADDER_OWNER]);
  if (error) return { error: true };
  const ids = ((patterns ?? []) as PatternRow[]).map((p) => p.id);
  if (ids.length === 0) return { ladders: [] };
  const { data: rungs, error: rungError } = await supabase.from("movement_pattern_exercises").select("movement_pattern_id, exercise_name, tier, is_unilateral").in("movement_pattern_id", ids);
  if (rungError) return { error: true };
  return { ladders: coachLadders(coachId, (patterns ?? []) as PatternRow[], (rungs ?? []) as RungRow[]) };
}
