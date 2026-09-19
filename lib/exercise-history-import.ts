// Data-orchestration layer for coach-facing exercise-history ingestion
// (coach_onboarding_history_ingestion_scoping_sept19.md) — real Supabase
// writes, no unit tests of its own (same convention as
// lib/equipment-load-ratio-gather.ts: only the pure parser it feeds off
// of, lib/history-import-parser.ts, is tested directly).
//
// Both lanes (manual quick-entry and CSV import) write into the exact
// same real logging tables every live workout uses — athlete_sessions ->
// session_exercises -> set_logs — rather than a parallel "historical
// data" system. Each entry is flagged is_historical on both the session
// and its sets so it's never confused with something actually performed
// live, and deliberately bypasses the complete_workout_session() RPC
// entirely: no workout_logs row, no exercise_records PR, no session
// credit spent, no feed post, no push notification. A backfilled entry
// from three months ago has no business showing up as "today's PR."
// What it DOES pick up for free, since it's real set_logs data: the
// trg_recompute_training_max trigger (grounds the AI program builder)
// and every existing "last time lifted" lookup (lib/workout-overview-
// data.ts), which is the entire point — closing the cold-start gap.
import type { SupabaseClient } from "@supabase/supabase-js";
import type { ParsedHistoryRow } from "./history-import-parser";

export interface ManualHistoryEntry {
  athleteId: string;
  groupId: string;
  exerciseName: string;
  weight: number | null;
  reps: number | null;
  rpe: number | null;
  date: string; // "YYYY-MM-DD"
}

async function createHistoricalSession(
  supabase: SupabaseClient,
  params: { athleteId: string; groupId: string; date: string }
): Promise<{ id: string } | null> {
  const timestamp = `${params.date}T12:00:00`; // noon, avoids any timezone date-shift at the boundary
  const { data, error } = await supabase
    .from("athlete_sessions")
    .insert({
      workout_id: null,
      group_id: params.groupId,
      athlete_id: params.athleteId,
      status: "completed",
      is_historical: true,
      started_at: timestamp,
      completed_at: timestamp,
    })
    .select("id")
    .single();
  if (error || !data) return null;
  return data;
}

export async function insertManualHistoryEntry(
  supabase: SupabaseClient,
  entry: ManualHistoryEntry
): Promise<{ error: string | null }> {
  const session = await createHistoricalSession(supabase, entry);
  if (!session) return { error: "Couldn't save this entry — try again." };

  const { data: exerciseRow, error: exerciseError } = await supabase
    .from("session_exercises")
    .insert({
      session_id: session.id,
      exercise_name: entry.exerciseName.trim(),
      exercise_order: 0,
      is_added: true,
    })
    .select("id")
    .single();
  if (exerciseError || !exerciseRow) return { error: "Couldn't save this entry — try again." };

  const { error: setError } = await supabase.from("set_logs").insert({
    session_exercise_id: exerciseRow.id,
    set_order: 0,
    weight: entry.weight,
    reps: entry.reps,
    rpe: entry.rpe,
    status: "completed",
    completed_at: `${entry.date}T12:00:00`,
    is_historical: true,
  });
  if (setError) return { error: "Couldn't save this entry — try again." };

  return { error: null };
}

export interface HistoryImportResult {
  importedCount: number;
  error: string | null;
}

// Groups the CSV's flat rows into one athlete_session per calendar date
// (this app's own established "same-day-logging-as-session-proxy"
// convention — body_weight_logs, daily_macros, and the equipment-load-
// ratio work all already treat one date as the natural session unit
// rather than threading a real session concept through import data that
// never had one), and within each date, one session_exercise per unique
// exercise name, with one set_log per row under it.
export async function importHistoryRows(
  supabase: SupabaseClient,
  params: { athleteId: string; groupId: string; rows: ParsedHistoryRow[] }
): Promise<HistoryImportResult> {
  const { athleteId, groupId, rows } = params;
  if (rows.length === 0) return { importedCount: 0, error: null };

  const rowsByDate = new Map<string, ParsedHistoryRow[]>();
  for (const row of rows) {
    const list = rowsByDate.get(row.date) ?? [];
    list.push(row);
    rowsByDate.set(row.date, list);
  }

  let importedCount = 0;

  for (const [date, dateRows] of rowsByDate.entries()) {
    const session = await createHistoricalSession(supabase, { athleteId, groupId, date });
    if (!session) continue;

    const exerciseIdByName = new Map<string, string>();
    const setOrderByExercise = new Map<string, number>();

    for (const row of dateRows) {
      let exerciseId: string | undefined = exerciseIdByName.get(row.exerciseName);
      if (!exerciseId) {
        const { data: exerciseRow } = await supabase
          .from("session_exercises")
          .insert({
            session_id: session.id,
            exercise_name: row.exerciseName.trim(),
            exercise_order: exerciseIdByName.size,
            is_added: true,
          })
          .select("id")
          .single();
        if (!exerciseRow) continue;
        const newExerciseId = exerciseRow.id as string;
        exerciseId = newExerciseId;
        exerciseIdByName.set(row.exerciseName, newExerciseId);
        setOrderByExercise.set(row.exerciseName, 0);
      }

      const setOrder = setOrderByExercise.get(row.exerciseName) ?? 0;
      const { error: setError } = await supabase.from("set_logs").insert({
        session_exercise_id: exerciseId,
        set_order: setOrder,
        weight: row.weight,
        reps: row.reps,
        rpe: row.rpe,
        status: "completed",
        completed_at: `${date}T12:00:00`,
        is_historical: true,
      });
      if (!setError) {
        importedCount++;
        setOrderByExercise.set(row.exerciseName, setOrder + 1);
      }
    }
  }

  return { importedCount, error: null };
}

export interface HistoricalEntryGroup {
  sessionId: string;
  date: string;
  exercises: { exerciseName: string; sets: { weight: number | null; reps: number | null; rpe: number | null }[] }[];
}

// Powers the review list under both uploaders — every historical session
// for this athlete, newest first, with its exercises/sets nested for
// display.
export async function listHistoricalEntries(
  supabase: SupabaseClient,
  athleteId: string
): Promise<HistoricalEntryGroup[]> {
  const { data: sessions } = await supabase
    .from("athlete_sessions")
    .select("id, completed_at")
    .eq("athlete_id", athleteId)
    .eq("is_historical", true)
    .order("completed_at", { ascending: false });
  if (!sessions || sessions.length === 0) return [];

  const sessionIds = sessions.map((s) => s.id as string);
  const { data: exerciseRows } = await supabase
    .from("session_exercises")
    .select("id, session_id, exercise_name, exercise_order")
    .in("session_id", sessionIds)
    .order("exercise_order", { ascending: true });

  const exerciseIds = (exerciseRows ?? []).map((e) => e.id as string);
  const { data: setRows } = exerciseIds.length
    ? await supabase
        .from("set_logs")
        .select("session_exercise_id, weight, reps, rpe, set_order")
        .in("session_exercise_id", exerciseIds)
        .order("set_order", { ascending: true })
    : { data: [] };

  const setsByExerciseId = new Map<string, { weight: number | null; reps: number | null; rpe: number | null }[]>();
  for (const row of setRows ?? []) {
    const list = setsByExerciseId.get(row.session_exercise_id as string) ?? [];
    list.push({ weight: row.weight as number | null, reps: row.reps as number | null, rpe: row.rpe as number | null });
    setsByExerciseId.set(row.session_exercise_id as string, list);
  }

  const exercisesBySessionId = new Map<string, HistoricalEntryGroup["exercises"]>();
  for (const ex of exerciseRows ?? []) {
    const list = exercisesBySessionId.get(ex.session_id as string) ?? [];
    list.push({
      exerciseName: ex.exercise_name as string,
      sets: setsByExerciseId.get(ex.id as string) ?? [],
    });
    exercisesBySessionId.set(ex.session_id as string, list);
  }

  return sessions.map((s) => ({
    sessionId: s.id as string,
    date: (s.completed_at as string).slice(0, 10),
    exercises: exercisesBySessionId.get(s.id as string) ?? [],
  }));
}

export async function deleteHistoricalSession(supabase: SupabaseClient, sessionId: string): Promise<{ error: string | null }> {
  const { error } = await supabase.from("athlete_sessions").delete().eq("id", sessionId).eq("is_historical", true);
  return { error: error ? "Couldn't delete this entry — try again." : null };
}
