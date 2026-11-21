import type { SupabaseClient } from "@supabase/supabase-js";

// "Just this week, or every week from here on?" (Ron, Nov 20: B4 in the builder, B5 when a client swaps an exercise during a workout). The database does the change
// (swap_exercise_every_week, step 219): the same slot of each later week of the program (the same day; the same progression slot when there is one, else the same place in the day), only where
// that slot still holds the same exercise, keeping each week's own sets, reps, set types, percent of max and progression. It is recorded so it can be undone (undo_exercise_swap). Before
// step 219 the check answers nothing and every rename works as it always did (this week only).

export interface EveryWeekResult {
  swap: string | null;
  /** later weeks changed (the exercise itself is not counted) */
  changed: number;
  weeks: number[];
  /** the later weeks' exercise ids that changed */
  ids: string[];
  byClient: boolean;
  from: string;
  to: string;
  program?: string;
  group?: string;
}

const asResult = (r: any): EveryWeekResult => ({
  swap: typeof r?.swap === "string" ? r.swap : null,
  changed: Number(r?.changed ?? 0) || 0,
  weeks: Array.isArray(r?.weeks) ? r.weeks.map(Number) : [],
  ids: Array.isArray(r?.ids) ? r.ids.map(String) : [],
  byClient: r?.byClient === true,
  from: String(r?.from ?? ""),
  to: String(r?.to ?? ""),
  program: typeof r?.program === "string" ? r.program : undefined,
  group: typeof r?.group === "string" ? r.group : undefined,
});

/** How many later weeks would change. Null when it cannot be told (before step 219, or the check failed): then only this week changes, as before. */
export async function laterWeeksToChange(supabase: SupabaseClient, exerciseId: string, newName: string, displayName: string | null): Promise<number | null> {
  try {
    // the dry run, under a read's name (lib/workspace-mutation.ts READ_RPC: asking never refreshes other panes)
    const { data, error } = await supabase.rpc("preview_exercise_every_week", { p_exercise: exerciseId, p_new_name: newName, p_display_name: displayName });
    if (error) return null;
    return asResult(data).changed;
  } catch {
    return null;
  }
}

/** Changes this exercise and the same slot of every later week. */
export async function swapEveryWeek(supabase: SupabaseClient, exerciseId: string, newName: string, displayName: string | null): Promise<{ ok: true; result: EveryWeekResult } | { ok: false; error: string }> {
  try {
    const { data, error } = await supabase.rpc("swap_exercise_every_week", { p_exercise: exerciseId, p_new_name: newName, p_display_name: displayName, p_dry_run: false });
    if (error) {
      if (/not authorized/i.test(error.message)) return { ok: false, error: "This can only be changed for every week on your own program." };
      if (/could not find the function|does not exist/i.test(error.message)) return { ok: false, error: "Changing every week isn't switched on yet. It was changed for this week only." };
      return { ok: false, error: "Couldn't change the other weeks. Try again." };
    }
    return { ok: true, result: asResult(data) };
  } catch {
    return { ok: false, error: "Couldn't change the other weeks. Check your connection and try again." };
  }
}

export interface RestoredExercise {
  id: string;
  exerciseName: string;
  displayName: string | null;
}

/** Puts back what one swap changed: the exercises that went back, each with its own name again (one changed since stays as it is), or null when it failed. */
export async function undoEveryWeekSwap(supabase: SupabaseClient, swapId: string): Promise<RestoredExercise[] | null> {
  try {
    const { data, error } = await supabase.rpc("undo_exercise_swap", { p_swap: swapId });
    if (error) return null;
    const rows = Array.isArray((data as { rows?: unknown })?.rows) ? ((data as { rows: { id: unknown; exercise_name: unknown; display_name: unknown }[] }).rows) : [];
    return rows.map((r) => ({ id: String(r.id), exerciseName: String(r.exercise_name ?? ""), displayName: typeof r.display_name === "string" ? r.display_name : null }));
  } catch {
    return null;
  }
}

/** The coach's question in the builder, and its tick box (unticked: just this week). */
export function everyWeekQuestion(from: string, to: string, laterWeeks: number): string {
  return `Change ${from} to ${to}? ${laterWeeks} later week${laterWeeks === 1 ? " has" : "s have"} ${from} in this place.`;
}
export function everyWeekChoice(laterWeeks: number): string {
  return `Every week from here on (${laterWeeks} later week${laterWeeks === 1 ? "" : "s"} too)`;
}

/** What is said once it is done ("Changed in this week and 3 later weeks."). */
export function everyWeekDone(laterWeeks: number): string {
  return laterWeeks === 0 ? "Changed for every week from here on (no later week had it in this place)." : `Changed in this week and ${laterWeeks} later week${laterWeeks === 1 ? "" : "s"}.`;
}

/** The coach's notice when a client did it. */
export function clientSwapNotice(clientName: string, from: string, to: string): string {
  return `${clientName} swapped ${from} for ${to} for every week.`;
}
