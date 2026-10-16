import type { SupabaseClient } from "@supabase/supabase-js";
import { OLD_JUNK_ROW_MESSAGE, cleanExerciseName, exerciseNameProblem, friendlyDbError } from "@/lib/exercise-name-guard";
import { existingLibraryName } from "@/lib/exercise-search";

// The one way an exercise enters the coach's library (the exercise card's "Add to my library", the library page, the FitPros "Add to library", a program import): the name is checked, a spelling of an exercise
// that is already there is pointed to instead of making a second row, and a failed write comes back as a plain message, never silently.
export type LibraryAdd =
  | { ok: true; name: string; alreadyThere: boolean; row: Record<string, unknown> | null }
  | { ok: false; error: string };

export async function addLibraryExercise(
  supabase: SupabaseClient,
  { userId, name, existingNames, fields = {}, select }: { userId: string; name: string; existingNames: string[]; fields?: Record<string, unknown>; select?: string }
): Promise<LibraryAdd> {
  const clean = cleanExerciseName(name);
  const problem = exerciseNameProblem(clean);
  if (problem) return { ok: false, error: problem };
  if (clean.length < 3) return { ok: false, error: "That name is too short to add to your library." };
  const there = existingLibraryName(clean, existingNames);
  if (there) return { ok: true, name: there, alreadyThere: true, row: null };

  const insert = supabase.from("exercise_library").insert({ created_by: userId, name: clean, ...fields });
  const { data, error } = select ? await insert.select(select).single() : await insert;
  if (error) return { ok: false, error: friendlyDbError(error.message) === OLD_JUNK_ROW_MESSAGE ? OLD_JUNK_ROW_MESSAGE : "Couldn't add that to your library. Try again." };
  return { ok: true, name: clean, alreadyThere: false, row: (data as unknown as Record<string, unknown> | null) ?? null };
}
