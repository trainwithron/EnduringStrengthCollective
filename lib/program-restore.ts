import type { SupabaseClient } from "@supabase/supabase-js";
import type { BuilderDay, BuilderExercise, BuilderNote } from "@/lib/types";
import { SET_ROW_SELECT, mapSetRow } from "@/lib/exercise-fields";

// "Undo" after deleting an exercise, a note, a day or a week in the program builder: the same rows are put back, with the same ids, in the same places. The builder keeps what it deleted for a few seconds
// (lib/undo-toast.ts). Anything that cannot be put back says so; it is never reported as restored when it is not.

type Db = SupabaseClient;

// What deleting a day also takes with it (database cascades): the single-day workouts the coach scheduled for clients, and the day note; it also cuts the link from clients' started sessions and logged
// workouts. Read BEFORE the delete so "Undo" can put all of it back, not just the template.
export interface DaySnapshot {
  note: string | null;
  assignments: Record<string, unknown>[];
  sessionIds: string[];
  logIds: string[];
}

export async function snapshotDays(supabase: Db, dayIds: string[]): Promise<Map<string, DaySnapshot>> {
  const out = new Map<string, DaySnapshot>();
  for (const id of dayIds) out.set(id, { note: null, assignments: [], sessionIds: [], logIds: [] });
  if (dayIds.length === 0) return out;
  const [days, assigned, sessions, logs] = await Promise.all([
    supabase.from("workouts").select("id, notes").in("id", dayIds),
    supabase.from("workout_assignments").select("*").in("workout_id", dayIds),
    supabase.from("athlete_sessions").select("id, workout_id").in("workout_id", dayIds),
    supabase.from("workout_logs").select("id, workout_id").in("workout_id", dayIds),
  ]);
  for (const d of (days.data ?? []) as Array<{ id: string; notes: string | null }>) out.get(d.id)!.note = d.notes ?? null;
  for (const a of (assigned.data ?? []) as Array<Record<string, unknown>>) out.get(String(a.workout_id))?.assignments.push(a);
  for (const s of (sessions.data ?? []) as Array<{ id: string; workout_id: string }>) out.get(s.workout_id)?.sessionIds.push(s.id);
  for (const l of (logs.data ?? []) as Array<{ id: string; workout_id: string }>) out.get(l.workout_id)?.logIds.push(l.id);
  return out;
}

// A client's own swap of an exercise goes when the exercise is deleted (cascade); read before the delete.
export async function snapshotExerciseOverrides(supabase: Db, exerciseId: string): Promise<Record<string, unknown>[]> {
  const { data } = await supabase.from("athlete_exercise_overrides").select("*").eq("group_workout_exercise_id", exerciseId);
  return (data ?? []) as Record<string, unknown>[];
}

function setRows(exerciseId: string, ex: BuilderExercise) {
  return ex.sets.map((st, i) => ({
    id: st.id,
    group_workout_exercise_id: exerciseId,
    set_order: i,
    target_reps: st.targetReps,
    target_weight: st.targetWeight,
    target_rpe: st.targetRpe,
    target_rir: st.targetRir,
    target_tempo: st.targetTempo,
    target_time_seconds: st.targetTimeSeconds,
    target_height: st.targetHeight,
    target_distance: st.targetDistance,
    target_rest_seconds: st.targetRestSeconds,
    target_rest_max_seconds: st.targetRestMaxSeconds ?? null,
    target_pace: st.targetPace,
    rep_min: st.repMin,
    rep_max: st.repMax,
  }));
}

export async function restoreExercise(supabase: Db, args: { groupId: string; workoutId: string; exercise: BuilderExercise; overrides?: Record<string, unknown>[] }): Promise<BuilderExercise | null> {
  const ex = args.exercise;
  const { error } = await supabase.from("group_workout_exercises").insert({
    id: ex.id,
    workout_id: args.workoutId,
    group_id: args.groupId,
    exercise_name: ex.exerciseName,
    display_name: ex.displayName,
    exercise_order: ex.order,
    movement_pattern_id: ex.movementPatternId,
    tracked_fields: ex.trackedFields,
    notes: ex.notes,
    ...(ex.slot ? { is_slot: true, slot_side: ex.slot.side, slot_tier: ex.slot.tier } : {}),
  });
  if (error) return null;
  let restored = ex;
  if (ex.sets.length > 0) {
    const { data, error: setsError } = await supabase.from("group_workout_exercise_sets").insert(setRows(ex.id, ex)).select(SET_ROW_SELECT);
    if (setsError || !data) return null;
    restored = { ...ex, sets: data.map(mapSetRow).sort((a, b) => a.setOrder - b.setOrder) };
  }
  // The clients' own swaps of this exercise come back with it.
  if (args.overrides && args.overrides.length > 0) {
    const { error: overrideError } = await supabase.from("athlete_exercise_overrides").insert(args.overrides);
    if (overrideError) return null;
  }
  return restored;
}

export async function restoreNote(supabase: Db, args: { groupId: string; workoutId: string; note: BuilderNote }): Promise<BuilderNote | null> {
  const {
    data: { user },
  } = await supabase.auth.getUser();
  const { error } = await supabase.from("workout_notes").insert({
    id: args.note.id,
    workout_id: args.workoutId,
    group_id: args.groupId,
    body: args.note.body,
    position: args.note.order,
    created_by: user?.id,
  });
  return error ? null : args.note;
}

export async function restoreDay(supabase: Db, args: { programId: string; groupId: string; day: BuilderDay; snapshot?: DaySnapshot }): Promise<BuilderDay | null> {
  const d = args.day;
  const { error } = await supabase.from("workouts").insert({
    id: d.id,
    program_id: args.programId,
    group_id: args.groupId,
    title: d.title,
    week_number: d.weekNumber,
    day_index: d.dayIndex,
    scheduled_date: d.scheduledDate,
    ...(args.snapshot?.note ? { notes: args.snapshot.note } : {}),
  });
  if (error) return null;
  const items: typeof d.items = [];
  for (const item of d.items) {
    const back =
      item.kind === "exercise"
        ? await restoreExercise(supabase, { groupId: args.groupId, workoutId: d.id, exercise: item })
        : await restoreNote(supabase, { groupId: args.groupId, workoutId: d.id, note: item });
    // A day that could not be fully put back is removed again, so half a day never sits in the program.
    if (!back) {
      await supabase.from("workouts").delete().eq("id", d.id);
      return null;
    }
    items.push(back);
  }
  // Single-day workouts scheduled for clients come back, and clients' started sessions and logged workouts are linked to the day again.
  const snap = args.snapshot;
  if (snap && snap.assignments.length > 0) {
    const { error: assignError } = await supabase.from("workout_assignments").insert(snap.assignments);
    if (assignError) {
      await supabase.from("workouts").delete().eq("id", d.id);
      return null;
    }
  }
  if (snap && snap.sessionIds.length > 0) await supabase.from("athlete_sessions").update({ workout_id: d.id }).in("id", snap.sessionIds);
  if (snap && snap.logIds.length > 0) await supabase.from("workout_logs").update({ workout_id: d.id }).in("id", snap.logIds);
  return { ...d, items };
}

export async function restoreDays(supabase: Db, args: { programId: string; groupId: string; days: BuilderDay[]; snapshots?: Map<string, DaySnapshot> }): Promise<BuilderDay[] | null> {
  const back: BuilderDay[] = [];
  for (const day of args.days.slice().sort((a, b) => a.dayIndex - b.dayIndex)) {
    const restored = await restoreDay(supabase, { programId: args.programId, groupId: args.groupId, day, snapshot: args.snapshots?.get(day.id) });
    if (!restored) {
      // Put back nothing partial: take away the days already restored in this undo.
      for (const r of back) await supabase.from("workouts").delete().eq("id", r.id);
      return null;
    }
    back.push(restored);
  }
  return back;
}
