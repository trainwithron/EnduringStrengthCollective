// Database side of the FitPros history import. It writes the same backdated history rows the existing history importer writes (athlete_sessions flagged is_historical -> session_exercises ->
// set_logs, also flagged), so it never creates a workout_logs row, a personal record, a spent session credit, a feed post, a push or a share card. What it adds: the session is linked to
// the program's own workout and its lines to the program's own exercises (so the day shows as done), plus duration, the per-exercise note, and set time, height and distance.
// An import is recognised again by the second in its time stamp (lib/fitpros-history.ts), so running it twice never doubles anything and "Undo this import" removes only these sessions.
import type { SupabaseClient } from "@supabase/supabase-js";
import { cleanExerciseName, exerciseNameProblem } from "@/lib/exercise-name-guard";
import { newImportBatchId } from "@/lib/exercise-history-import";
import { importKeys, isImportMarker, markerTimestamp, resolveNamesAgainstLibrary, IMPORT_MARKER_FIRST_SECOND, type PlannedWorkout, type ProgramWorkoutInfo } from "@/lib/fitpros-history";

export interface ImportProgram {
  programId: string;
  name: string;
  startDate: string | null;
  workouts: ProgramWorkoutInfo[];
  // Program workouts that already have a session of their own for this client (not counting an earlier run of this import).
  takenWorkoutIds: string[];
}

// The client's active program in this group, with its workouts and exercise lines.
export async function loadProgramForImport(supabase: SupabaseClient, groupId: string, athleteId: string): Promise<ImportProgram | null> {
  const { data: program } = await supabase
    .from("programs")
    .select("id, name, start_date")
    .eq("group_id", groupId)
    .eq("athlete_id", athleteId)
    .eq("is_active", true)
    .is("archived_at", null)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (!program) return null;
  const { data: workoutRows } = await supabase.from("workouts").select("id, title, week_number, day_index").eq("program_id", program.id as string);
  const ids = (workoutRows ?? []).map((w) => w.id as string);
  const { data: lineRows } = ids.length
    ? await supabase.from("group_workout_exercises").select("id, workout_id, exercise_name, exercise_order").in("workout_id", ids).order("exercise_order", { ascending: true })
    : { data: [] };
  const { data: sessionRows } = ids.length ? await supabase.from("athlete_sessions").select("workout_id, started_at").eq("athlete_id", athleteId).in("workout_id", ids) : { data: [] };
  const takenWorkoutIds = (sessionRows ?? []).filter((r) => !isImportMarker(r.started_at as string | null)).map((r) => r.workout_id as string);
  const byWorkout = new Map<string, { id: string; name: string }[]>();
  for (const l of lineRows ?? []) {
    const list = byWorkout.get(l.workout_id as string) ?? [];
    list.push({ id: l.id as string, name: l.exercise_name as string });
    byWorkout.set(l.workout_id as string, list);
  }
  return {
    programId: program.id as string,
    name: program.name as string,
    startDate: (program.start_date as string | null) ?? null,
    takenWorkoutIds,
    workouts: (workoutRows ?? []).map((w) => ({
      id: w.id as string,
      title: (w.title as string) ?? "",
      weekNumber: Number(w.week_number),
      dayIndex: Number(w.day_index),
      exercises: byWorkout.get(w.id as string) ?? [],
    })),
  };
}

// Matches the plan's exercise names to the coach's library (a spelling of a library exercise, the same movement under another name, the coach's saved aliases) and marks the ones that are not in it.
export async function markLibrary(supabase: SupabaseClient, plan: PlannedWorkout[]): Promise<PlannedWorkout[]> {
  const [{ data: library }, { data: aliasRows }] = await Promise.all([
    supabase.from("exercise_library").select("name"),
    supabase.from("exercise_aliases").select("raw_name, exercise_name"),
  ]);
  return resolveNamesAgainstLibrary(
    plan,
    (library ?? []).map((r) => r.name as string),
    (aliasRows ?? []).map((r) => ({ rawName: r.raw_name as string, exerciseName: r.exercise_name as string }))
  );
}

export interface ImportedSession {
  id: string;
  key: string; // date#nth
}

// The sessions an earlier run of this import already wrote for the client.
export async function listImportedSessions(supabase: SupabaseClient, groupId: string, athleteId: string): Promise<ImportedSession[]> {
  const { data } = await supabase.from("athlete_sessions").select("id, started_at").eq("group_id", groupId).eq("athlete_id", athleteId).eq("is_historical", true).limit(5000);
  const out: ImportedSession[] = [];
  for (const row of data ?? []) {
    const started = row.started_at as string | null;
    if (!isImportMarker(started)) continue;
    const date = (started as string).slice(0, 10);
    const second = Number(/T12:00:(\d{2})/.exec(started as string)?.[1] ?? IMPORT_MARKER_FIRST_SECOND);
    out.push({ id: row.id as string, key: `${date}#${second - IMPORT_MARKER_FIRST_SECOND}` });
  }
  return out;
}

export interface ImportResult {
  // One id on every session this run wrote (like the spreadsheet import), so the History list offers "Undo this import" for it.
  batchId: string;
  imported: number;
  skippedAlreadyThere: number;
  failed: string[];
}

export async function runFitprosImport(
  supabase: SupabaseClient,
  params: { athleteId: string; groupId: string; plan: PlannedWorkout[]; existingKeys: Set<string> }
): Promise<ImportResult> {
  const { athleteId, groupId, plan, existingKeys } = params;
  const keys = importKeys(plan);
  const result: ImportResult = { batchId: newImportBatchId(), imported: 0, skippedAlreadyThere: 0, failed: [] };
  for (let i = 0; i < plan.length; i++) {
    const w = plan[i];
    if (existingKeys.has(keys[i])) {
      result.skippedAlreadyThere++;
      continue;
    }
    // Nothing is written for a day with an exercise name that is only numbers or carries sets and reps (the file was probably laid out wrongly).
    const badName = w.exercises.find((e) => exerciseNameProblem(e.savedName));
    if (badName) {
      result.failed.push(`${w.date}: ${exerciseNameProblem(badName.savedName)}`);
      continue;
    }
    const nth = Number(keys[i].split("#")[1]);
    const started = markerTimestamp(w.date, nth);
    const completed = w.durationSeconds ? new Date(new Date(started).getTime() + w.durationSeconds * 1000).toISOString() : started;
    const { data: session, error: sessionError } = await supabase
      .from("athlete_sessions")
      .insert({
        workout_id: w.programWorkoutId,
        group_id: groupId,
        athlete_id: athleteId,
        status: "completed",
        is_historical: true,
        import_batch_id: result.batchId,
        started_at: started,
        completed_at: completed,
        duration_seconds: w.durationSeconds,
      })
      .select("id")
      .single();
    if (sessionError || !session) {
      result.failed.push(`${w.date}: the session did not save`);
      continue;
    }
    const exerciseRows = w.exercises.map((e, order) => ({
      session_id: session.id as string,
      exercise_name: cleanExerciseName(e.savedName),
      exercise_order: order,
      group_workout_exercise_id: e.programExerciseId,
      is_added: e.programExerciseId == null,
      athlete_note: e.note,
    }));
    const { data: inserted, error: exerciseError } = exerciseRows.length
      ? await supabase.from("session_exercises").insert(exerciseRows).select("id, exercise_order")
      : { data: [], error: null };
    if (exerciseError || !inserted) {
      await supabase.from("athlete_sessions").delete().eq("id", session.id as string).eq("is_historical", true);
      result.failed.push(`${w.date}: the exercises did not save`);
      continue;
    }
    const idByOrder = new Map(inserted.map((r) => [Number(r.exercise_order), r.id as string]));
    const setRows = w.exercises.flatMap((e, order) =>
      e.sets.map((s, setOrder) => ({
        session_exercise_id: idByOrder.get(order) as string,
        set_order: setOrder,
        weight: s.weight,
        ...(s.unclearReason ? { data_flag: "unclear", data_flag_reason: s.unclearReason } : {}),
        reps: s.reps,
        time_seconds: s.timeSeconds,
        height: s.height,
        distance: s.distance,
        status: "completed",
        completed_at: started,
        is_historical: true,
      }))
    );
    if (setRows.length > 0) {
      const { error: setError } = await supabase.from("set_logs").insert(setRows);
      if (setError) {
        await supabase.from("athlete_sessions").delete().eq("id", session.id as string).eq("is_historical", true);
        result.failed.push(`${w.date}: the sets did not save`);
        continue;
      }
    }
    result.imported++;
  }
  return result;
}

// Removes exactly the sessions this import wrote (their exercises and sets go with them).
export async function undoFitprosImport(supabase: SupabaseClient, groupId: string, athleteId: string): Promise<{ removed: number; error: string | null }> {
  const sessions = await listImportedSessions(supabase, groupId, athleteId);
  if (sessions.length === 0) return { removed: 0, error: null };
  const { data, error } = await supabase
    .from("athlete_sessions")
    .delete()
    .in("id", sessions.map((s) => s.id))
    .eq("is_historical", true)
    .select("id");
  if (error) return { removed: 0, error: "Couldn't undo the import. Try again." };
  return { removed: data?.length ?? 0, error: null };
}

// The coach may move the program's start date back so the history lines up with the weeks.
// Returns the start date the database now holds, or null when the change did not happen (no row changed, an error, or the stored date is not the one asked for).
export async function moveProgramStart(supabase: SupabaseClient, programId: string, startDate: string): Promise<string | null> {
  const { data, error } = await supabase.from("programs").update({ start_date: startDate }).eq("id", programId).select("id, start_date");
  if (error || !data || data.length === 0) return null;
  const stored = (data[0] as { start_date: string | null }).start_date;
  return stored === startDate ? stored : null;
}
