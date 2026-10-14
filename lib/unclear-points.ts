// Unclear data points in imported history (release CA). A set from an import that looks jumbled or impossible is KEPT exactly as entered, marked with a question mark, and left out of the numbers
// until the coach decides. The rules that mark a set live in one place, the database function flag_unclear_sets (migration 0371); this file is the app's side: reading the marks, the coach's
// decision, and the plain words.
import type { SupabaseClient } from "@supabase/supabase-js";

export const UNCLEAR_LABEL = "Unclear data point (not counted)";
export const UNCLEAR_COUNTED_LABEL = "Unclear data point (counted)";
export const IMPORT_BASELINE_NOTE = "Imported history gives you a baseline. It won't be perfect: values are backdated and some may need fixing by hand.";
export const IMPORT_UNITS_NOTE = "Imports are read as pounds.";

export type DataFlag = "unclear" | "accepted";

export interface UnclearPoint {
  id: string;
  sessionId: string;
  date: string; // YYYY-MM-DD
  exerciseName: string;
  weight: number | null;
  reps: number | null;
  reason: string;
  flag: DataFlag;
}

export function unclearLabel(flag: DataFlag | null | undefined): string | null {
  if (flag === "unclear") return UNCLEAR_LABEL;
  if (flag === "accepted") return UNCLEAR_COUNTED_LABEL;
  return null;
}

// "3 unclear data points found. They are kept as entered and not counted." / nothing for zero.
export function unclearFoundLine(n: number): string {
  if (n <= 0) return "";
  return `${n} unclear data point${n === 1 ? "" : "s"} found. ${n === 1 ? "It is" : "They are"} kept as entered and not counted; review ${n === 1 ? "it" : "them"} on this page.`;
}

// Only ever adds marks (never changes a number, never undoes a decision). Returns how many sets it newly marked; 0 when it could not run.
export async function flagUnclearSets(supabase: SupabaseClient, groupId: string, athleteId: string): Promise<number> {
  const { data, error } = await supabase.rpc("flag_unclear_sets", { p_athlete: athleteId, p_group: groupId });
  if (error) return 0;
  return typeof data === "number" ? data : 0;
}

// Rebuilds the athlete's estimated training maxes from the sets that count (an unclear point never does), so an import, a removal or a decision about an unclear point gives the right number.
export async function recomputeTrainingMaxes(supabase: SupabaseClient, athleteId: string): Promise<void> {
  await supabase.rpc("recompute_training_maxes", { p_athlete: athleteId, p_exercise: null });
}

// After any history is written or removed: mark what looks unclear, then fold what counts into the training maxes. Returns how many sets were newly marked.
export async function settleImportedHistory(supabase: SupabaseClient, groupId: string, athleteId: string): Promise<number> {
  const marked = await flagUnclearSets(supabase, groupId, athleteId);
  await recomputeTrainingMaxes(supabase, athleteId);
  return marked;
}

export async function listUnclearPoints(supabase: SupabaseClient, groupId: string, athleteId: string): Promise<UnclearPoint[]> {
  const { data } = await supabase
    .from("set_logs")
    .select("id, weight, reps, data_flag, data_flag_reason, session_exercises!inner ( exercise_name, session_id, athlete_sessions!inner ( athlete_id, group_id, started_at ) )")
    .eq("session_exercises.athlete_sessions.athlete_id", athleteId)
    .eq("session_exercises.athlete_sessions.group_id", groupId)
    .not("data_flag", "is", null)
    .limit(500);
  const points: UnclearPoint[] = (data ?? []).map((row: any) => ({
    id: row.id as string,
    sessionId: row.session_exercises.session_id as string,
    date: String(row.session_exercises.athlete_sessions.started_at).slice(0, 10),
    exerciseName: row.session_exercises.exercise_name as string,
    weight: (row.weight as number | null) ?? null,
    reps: (row.reps as number | null) ?? null,
    reason: (row.data_flag_reason as string | null) ?? "",
    flag: row.data_flag as DataFlag,
  }));
  // Still-unclear first, then newest first.
  return points.sort((a, b) => (a.flag === b.flag ? b.date.localeCompare(a.date) : a.flag === "unclear" ? -1 : 1));
}

// The coach counts the point (true) or leaves it out of the numbers again (false). Returns an error line, or null when it worked.
export async function setUnclearPointCounted(supabase: SupabaseClient, setId: string, counts: boolean): Promise<string | null> {
  const { error } = await supabase.rpc("set_unclear_point_counted", { p_set: setId, p_counts: counts });
  return error ? "Couldn't save that. Try again." : null;
}

// The coach fixes the numbers by hand and counts the corrected point. Blank stays blank; the values are plain non-negative numbers.
export async function fixUnclearPoint(supabase: SupabaseClient, setId: string, weight: number | null, reps: number | null): Promise<string | null> {
  if ((weight != null && (!Number.isFinite(weight) || weight < 0)) || (reps != null && (!Number.isFinite(reps) || reps < 0 || !Number.isInteger(reps)))) {
    return "Use whole reps and a weight of zero or more.";
  }
  const { data, error } = await supabase.from("set_logs").update({ weight, reps }).eq("id", setId).select("id");
  if (error || !data || data.length === 0) return "Couldn't save that. Try again.";
  return setUnclearPointCounted(supabase, setId, true);
}
