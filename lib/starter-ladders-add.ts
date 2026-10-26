import type { SupabaseClient } from "@supabase/supabase-js";
import { buildRungInserts, planStarterAdd, starterResultLine, type ExistingPattern } from "@/lib/starter-ladders";

// "Add the starter ladders" (lib/starter-ladders.ts): a ladder for every movement pattern, easiest at the top, in the coach's OWN library. Only what is missing is added; nothing they have is changed.
// One code path for the Exercise Library's button, for + Slot when the coach has no patterns yet, and for Make a template when the coach has no ladders yet (Ron: defaults are made for him, he is
// never sent to another setup step). Returns the coach's patterns afterwards, so the caller can show them at once.
export async function addStarterLadders(
  supabase: SupabaseClient,
  userId: string
): Promise<{ ok: true; line: string; patterns: { id: string; name: string }[] } | { ok: false }> {
  try {
    const { data: rows, error: readError } = await supabase
      .from("movement_patterns")
      .select("id, name, movement_pattern_exercises ( exercise_name, difficulty_rank )")
      .eq("created_by", userId);
    if (readError) return { ok: false };
    const existing: (ExistingPattern & { maxRank: number })[] = ((rows ?? []) as any[]).map((p) => ({
      id: p.id as string,
      name: p.name as string,
      exerciseNames: ((p.movement_pattern_exercises ?? []) as any[]).map((e) => e.exercise_name as string),
      maxRank: Math.max(-1, ...((p.movement_pattern_exercises ?? []) as any[]).map((e) => Number(e.difficulty_rank) || 0)),
    }));
    const { data: libraryRows } = await supabase.from("exercise_library").select("name").eq("created_by", userId);
    const plan = planStarterAdd(existing, ((libraryRows ?? []) as { name: string }[]).map((r) => r.name));
    const idByName = new Map<string, string>(existing.map((p) => [p.name, p.id as string]));
    if (plan.newPatterns.length > 0) {
      const { data: created, error: createError } = await supabase
        .from("movement_patterns")
        .insert(plan.newPatterns.map((p) => ({ created_by: userId, name: p.name, plane: p.plane })))
        .select("id, name");
      if (createError) return { ok: false };
      for (const c of (created ?? []) as { id: string; name: string }[]) idByName.set(c.name, c.id);
    }
    const maxRank = new Map<string, number>(existing.filter((p) => p.exerciseNames.length > 0).map((p) => [p.name, p.maxRank]));
    const inserts = buildRungInserts(plan, idByName, maxRank);
    if (inserts.length > 0) {
      const { error: rungError } = await supabase.from("movement_pattern_exercises").insert(inserts);
      if (rungError) return { ok: false };
    }
    const { data: after } = await supabase.from("movement_patterns").select("id, name").eq("created_by", userId).order("name");
    return { ok: true, line: starterResultLine(plan), patterns: ((after ?? []) as { id: string; name: string }[]).map((p) => ({ id: p.id, name: p.name })) };
  } catch {
    return { ok: false };
  }
}
