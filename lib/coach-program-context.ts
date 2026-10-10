import type { SupabaseClient } from "@supabase/supabase-js";
import { buildProgrammingProfile } from "@/lib/builder-context";

// What the app knows about how a coach programs, for the conversation: the shape of their sessions (the same profile the builder gets), the names of their latest programs, and the
// standing preferences they already have. Only the coach's own rows, through the coach's own session. Nothing about any client.
export async function loadProgrammingContext(supabase: SupabaseClient, coachId: string): Promise<{ profile: string | null; programNames: string[]; preferences: string[] }> {
  const [{ data: programs }, { data: prefs }, { data: patternRows }] = await Promise.all([
    supabase.from("programs").select("id, name").eq("created_by", coachId).eq("ai_draft", false).order("created_at", { ascending: false }).limit(12),
    supabase.from("coach_program_preferences").select("condition_text, preference_text").eq("coach_id", coachId).order("created_at", { ascending: false }).limit(30),
    supabase.from("movement_pattern_exercises").select("exercise_name, movement_patterns!inner ( name, created_by )").eq("movement_patterns.created_by", coachId).limit(5000),
  ]);
  const ids = ((programs ?? []) as { id: string }[]).map((p) => p.id);
  const { data: workouts } = ids.length
    ? await supabase
        .from("workouts")
        .select("group_workout_exercises ( exercise_name, exercise_order, group_workout_exercise_sets ( target_reps ) )")
        .in("program_id", ids)
        .eq("week_number", 1)
    : { data: [] as any[] };
  const patternByName = new Map<string, string>();
  for (const row of (patternRows ?? []) as any[]) if (row.movement_patterns?.name && !patternByName.has(row.exercise_name)) patternByName.set(row.exercise_name, row.movement_patterns.name);
  const sessions = ((workouts ?? []) as any[]).map((w) => ({
    exercises: ((w.group_workout_exercises ?? []) as any[])
      .slice()
      .sort((a, b) => a.exercise_order - b.exercise_order)
      .map((e) => ({ name: e.exercise_name as string, sets: (e.group_workout_exercise_sets ?? []).length, reps: (e.group_workout_exercise_sets ?? [])[0]?.target_reps ?? null })),
  }));
  return {
    profile: buildProgrammingProfile(sessions, (name) => patternByName.get(name) ?? null),
    programNames: ((programs ?? []) as { name: string }[]).map((p) => p.name),
    preferences: ((prefs ?? []) as { condition_text: string; preference_text: string }[]).map((p) => `When ${p.condition_text}: ${p.preference_text}`),
  };
}
