import type { SupabaseClient } from "@supabase/supabase-js";

// Section headers inside a workout (Ron, Nov 20: B3): "Warm-up", "Strength", "Conditioning" or any words, between exercises. A header is a day note marked as a header (workout_notes.is_header,
// step 219), so it moves, is renamed and is deleted like a note, and copies (Duplicate week, Undo, Assign / Duplicate / Make a template) keep it. Like a note, a header between two linked
// exercises ends the superset there (a section never runs through the middle of one). Read on their own, so every screen opens as before when the column is not there yet (no headers).

export const SECTION_HEADER_MAX = 40;

/** What is wrong with a header's words, or null: something written, and short enough to be a header. */
export function sectionHeaderProblem(text: string): string | null {
  const t = text.trim();
  if (!t) return "Write the header, e.g. Warm-up.";
  if (t.length > SECTION_HEADER_MAX) return `A header is at most ${SECTION_HEADER_MAX} characters.`;
  return null;
}

/** The day notes of a program that are headers. */
export async function headerNotesOfProgram(supabase: SupabaseClient, programId: string): Promise<Set<string>> {
  try {
    const { data, error } = await supabase.from("workout_notes").select("id, workouts!inner ( program_id )").eq("workouts.program_id", programId).eq("is_header", true).limit(2000);
    if (error) return new Set();
    return new Set(((data ?? []) as { id: string }[]).map((r) => r.id));
  } catch {
    return new Set();
  }
}

export interface SectionHeader {
  id: string;
  body: string;
  position: number;
}

/** The headers of these workouts (a workout's day, or a team sheet's days), by workout, in order. */
export async function headersOfWorkouts(supabase: SupabaseClient, workoutIds: string[]): Promise<Map<string, SectionHeader[]>> {
  const out = new Map<string, SectionHeader[]>();
  const ids = Array.from(new Set(workoutIds)).slice(0, 200);
  if (ids.length === 0) return out;
  try {
    const { data, error } = await supabase.from("workout_notes").select("id, workout_id, body, position").in("workout_id", ids).eq("is_header", true).order("position").limit(2000);
    if (error) return out;
    for (const r of (data ?? []) as (SectionHeader & { workout_id: string })[]) {
      if (!r.body?.trim()) continue;
      out.set(r.workout_id, [...(out.get(r.workout_id) ?? []), { id: r.id, body: r.body.trim(), position: r.position }]);
    }
  } catch {
    // no headers
  }
  return out;
}

/**
 * Which header goes above which exercise: each header heads the first exercise placed after it in the day (exercises and notes share one order). A header with no exercise after it heads
 * nothing and is not shown to the client; two headers in a row both show (the last one nearest its exercise). Returns, by exercise index, the headers above it.
 */
export function headersAbove(exerciseOrders: number[], headers: { position: number; body: string }[]): Map<number, string[]> {
  const out = new Map<number, string[]>();
  const order = exerciseOrders.map((o, i) => ({ o, i })).sort((a, b) => a.o - b.o || a.i - b.i);
  for (const h of headers.slice().sort((a, b) => a.position - b.position)) {
    const next = order.find((e) => e.o > h.position);
    if (!next) continue;
    out.set(next.i, [...(out.get(next.i) ?? []), h.body]);
  }
  return out;
}
