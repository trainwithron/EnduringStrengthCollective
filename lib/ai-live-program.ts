import type { SupabaseClient } from "@supabase/supabase-js";
import { chunk } from "@/lib/chunk";

// The AI day builder writes straight into the program that is open. That is right while a program is being built, but a program clients are already training on must not change under them without the coach's
// sign-off, so the AI builds and fixes only programs nobody follows yet. "Followed" means: the program is switched on, is not an unsigned AI draft, and at least one of its workouts has been started by someone.
export function programIsFollowed(input: { isActive: boolean; aiDraft: boolean; hasStartedWorkouts: boolean }): boolean {
  return input.isActive && !input.aiDraft && input.hasStartedWorkouts;
}

export const FOLLOWED_PROGRAM_MESSAGE = "Clients are already training on this program, so the AI will not change it. Make a copy first (Assign to clients makes one), then use the AI on the copy.";

// Reads what it needs and says whether the program is followed. If anything cannot be read the careful answer is "followed": nothing is written.
export async function readProgramIsFollowed(supabase: SupabaseClient, programId: string): Promise<boolean> {
  const { data: program, error } = await supabase.from("programs").select("is_active, ai_draft").eq("id", programId).maybeSingle();
  if (error || !program) return true;
  let hasStartedWorkouts = false;
  if (program.is_active && !program.ai_draft) {
    const { data: workouts, error: workoutsError } = await supabase.from("workouts").select("id").eq("program_id", programId);
    const ids = (workouts ?? []).map((w: { id: string }) => w.id);
    if (workoutsError) hasStartedWorkouts = true;
    else {
      // The workouts are asked about 100 at a time (a long list in one request would be too long to send); the first one that has been started settles it, and any failure counts as "followed".
      for (const part of chunk(ids, 100)) {
        const { count, error: startedError } = await supabase.from("athlete_sessions").select("id", { count: "exact", head: true }).in("workout_id", part);
        if (startedError || (count ?? 0) > 0) {
          hasStartedWorkouts = true;
          break;
        }
      }
    }
  }
  return programIsFollowed({ isActive: !!program.is_active, aiDraft: !!program.ai_draft, hasStartedWorkouts });
}
