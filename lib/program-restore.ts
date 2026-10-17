import type { SupabaseClient } from "@supabase/supabase-js";
import type { BuilderDay, BuilderExercise, BuilderNote } from "@/lib/types";
import { SET_ROW_SELECT, mapSetRow } from "@/lib/exercise-fields";

// "Undo" after deleting an exercise, a note, a day or a week in the program builder: the same rows are put back, with the same ids, in the same places. The builder keeps what it deleted for a few seconds
// (lib/undo-toast.ts). Anything that cannot be put back says so; it is never reported as restored when it is not.

type Db = SupabaseClient;

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

export async function restoreExercise(supabase: Db, args: { groupId: string; workoutId: string; exercise: BuilderExercise }): Promise<BuilderExercise | null> {
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
  if (ex.sets.length === 0) return ex;
  const { data, error: setsError } = await supabase.from("group_workout_exercise_sets").insert(setRows(ex.id, ex)).select(SET_ROW_SELECT);
  if (setsError || !data) return null;
  return { ...ex, sets: data.map(mapSetRow).sort((a, b) => a.setOrder - b.setOrder) };
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

export async function restoreDay(supabase: Db, args: { programId: string; groupId: string; day: BuilderDay }): Promise<BuilderDay | null> {
  const d = args.day;
  const { error } = await supabase.from("workouts").insert({
    id: d.id,
    program_id: args.programId,
    group_id: args.groupId,
    title: d.title,
    week_number: d.weekNumber,
    day_index: d.dayIndex,
    scheduled_date: d.scheduledDate,
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
  return { ...d, items };
}

export async function restoreDays(supabase: Db, args: { programId: string; groupId: string; days: BuilderDay[] }): Promise<BuilderDay[] | null> {
  const back: BuilderDay[] = [];
  for (const day of args.days.slice().sort((a, b) => a.dayIndex - b.dayIndex)) {
    const restored = await restoreDay(supabase, { programId: args.programId, groupId: args.groupId, day });
    if (!restored) {
      // Put back nothing partial: take away the days already restored in this undo.
      for (const r of back) await supabase.from("workouts").delete().eq("id", r.id);
      return null;
    }
    back.push(restored);
  }
  return back;
}
