import type { SupabaseClient } from "@supabase/supabase-js";
import { cleanExerciseName, exerciseNameProblem } from "@/lib/exercise-name-guard";

// The one way a program day's exercise is renamed (the builder card and the recap screen both use it): the name is checked, the shown (alias) name is set or cleared with it, and the program's
// progression rule for the old name moves to the new one, so a rename never leaves a rule pointing at nothing.
export async function renameProgramExercise(
  supabase: SupabaseClient,
  { exerciseId, workoutId, oldName, newName, displayName = null }: { exerciseId: string; workoutId: string; oldName: string; newName: string; displayName?: string | null }
): Promise<{ error: string | null; name: string }> {
  const name = cleanExerciseName(newName);
  const problem = exerciseNameProblem(name);
  if (problem) return { error: problem, name };

  const { error } = await supabase.from("group_workout_exercises").update({ exercise_name: name, display_name: displayName }).eq("id", exerciseId);
  if (error) return { error: "Couldn't rename that exercise. Try again.", name };

  if (oldName !== name) await moveProgression(supabase, { workoutId, oldName, newName: name });
  return { error: null, name };
}

// The rule follows the exercise only when no other day of the program still uses the old name, and never over a rule the new name already has.
export async function moveProgression(supabase: SupabaseClient, { workoutId, oldName, newName }: { workoutId: string; oldName: string; newName: string }): Promise<void> {
  const { data: w } = await supabase.from("workouts").select("program_id").eq("id", workoutId).maybeSingle();
  const programId = (w as { program_id?: string } | null)?.program_id;
  if (!programId) return;
  const { data: stillUsed } = await supabase.from("group_workout_exercises").select("id, workouts!inner ( program_id )").eq("workouts.program_id", programId).eq("exercise_name", oldName).limit(1);
  if ((stillUsed ?? []).length > 0) return;
  const { data: already } = await supabase.from("exercise_progressions").select("id").eq("program_id", programId).eq("exercise_name", newName).limit(1);
  if ((already ?? []).length > 0) return;
  await supabase.from("exercise_progressions").update({ exercise_name: newName }).eq("program_id", programId).eq("exercise_name", oldName);
}
