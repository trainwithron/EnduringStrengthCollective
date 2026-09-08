import type { SupabaseClient } from "@supabase/supabase-js";

export interface DuplicateProgramOptions {
  sourceProgramId: string;
  destinationGroupId: string;
  createdBy: string;
  // Personal copy for one client when set; a plain shared duplicate when
  // omitted. Every child row (workouts, exercises, sets, notes) inherits
  // this automatically via the set_workout_athlete_id/set_gwe_athlete_id/
  // set_workout_notes_athlete_id triggers — nothing else in this function
  // needs to set it explicitly.
  athleteId?: string;
  // Personal copies get a readable suffix; plain duplicates keep the
  // exact source name (the coach can rename either afterward).
  clientName?: string;
  // Overrides the copied start_date so the new copy's schedule is
  // correctly anchored from the moment it's actually assigned, rather
  // than inheriting whatever date the source program happened to start
  // on (which is very often already in the past by the time a program
  // gets duplicated for a new client). training_days/visibility_window
  // still copy forward as-is — only the anchor date changes.
  startDate?: string;
}

// Deep-copies a whole program — every week/day, exercise, set, and note —
// into a brand-new, fully independent set of rows. Generalizes
// components/coach/desktop/duplicate-week-panel.tsx's existing per-week
// copy loop one level up (every week in the program, not just one), and
// is the shared engine behind both "Assign to Client" (athleteId set) and
// the plain "Duplicate" action (athleteId omitted) — including duplicating
// into a different group entirely (destinationGroupId), which is all
// cross-organization duplication turns out to be: the same copy, pointed
// at a group in another org.
export async function duplicateProgram(
  supabase: SupabaseClient,
  { sourceProgramId, destinationGroupId, createdBy, athleteId, clientName, startDate }: DuplicateProgramOptions
): Promise<{ programId: string } | { error: string }> {
  const { data: sourceProgram } = await supabase
    .from("programs")
    .select("name, description, start_date, training_days, visibility_window")
    .eq("id", sourceProgramId)
    .single();

  if (!sourceProgram) {
    return { error: "Source program not found." };
  }

  const newName = clientName ? `${sourceProgram.name} — ${clientName}` : sourceProgram.name;

  // Deactivate this new copy's *own* siblings, scoped correctly: a
  // personal copy only steps down other personal programs for that same
  // (group, athlete) pair; a shared copy only steps down other shared
  // programs in the destination group. Mirrors new-program-form.tsx's
  // existing single-active-program logic, just correctly scoped so
  // assigning a personal program never touches the shared group program's
  // active flag, or a different client's.
  const { data: newProgram, error: programError } = await supabase
    .from("programs")
    .insert({
      group_id: destinationGroupId,
      name: newName,
      description: sourceProgram.description,
      created_by: createdBy,
      athlete_id: athleteId ?? null,
      is_active: true,
      start_date: startDate ?? sourceProgram.start_date,
      training_days: sourceProgram.training_days,
      visibility_window: sourceProgram.visibility_window,
    })
    .select("id")
    .single();

  if (programError || !newProgram) {
    return { error: programError?.message ?? "Couldn't create the duplicated program." };
  }

  let deactivateQuery = supabase
    .from("programs")
    .update({ is_active: false })
    .eq("group_id", destinationGroupId)
    .neq("id", newProgram.id);
  deactivateQuery = athleteId
    ? deactivateQuery.eq("athlete_id", athleteId)
    : deactivateQuery.is("athlete_id", null);
  await deactivateQuery;

  const { data: sourceWorkouts } = await supabase
    .from("workouts")
    .select(
      `
      id, title, week_number, day_index, notes,
      group_workout_exercises ( id, exercise_name, exercise_order, movement_pattern_id, tracked_fields, notes,
        group_workout_exercise_sets ( set_order, target_reps, target_weight, target_rpe, target_rir, target_tempo, target_time_seconds, target_height, target_distance, rep_min, rep_max )
      ),
      workout_notes ( body, position )
    `
    )
    .eq("program_id", sourceProgramId)
    .order("week_number", { ascending: true })
    .order("day_index", { ascending: true });

  for (const w of (sourceWorkouts ?? []) as any[]) {
    const { data: newWorkout } = await supabase
      .from("workouts")
      .insert({
        program_id: newProgram.id,
        group_id: destinationGroupId,
        title: w.title,
        week_number: w.week_number,
        day_index: w.day_index,
        notes: w.notes,
      })
      .select("id")
      .single();
    if (!newWorkout) continue;

    for (const ex of w.group_workout_exercises ?? []) {
      const { data: newExercise } = await supabase
        .from("group_workout_exercises")
        .insert({
          workout_id: newWorkout.id,
          group_id: destinationGroupId,
          exercise_name: ex.exercise_name,
          exercise_order: ex.exercise_order,
          movement_pattern_id: ex.movement_pattern_id,
          tracked_fields: ex.tracked_fields,
          notes: ex.notes,
        })
        .select("id")
        .single();
      if (!newExercise) continue;

      const sets = (ex.group_workout_exercise_sets ?? []).map((s: any) => ({
        group_workout_exercise_id: newExercise.id,
        set_order: s.set_order,
        target_reps: s.target_reps,
        target_weight: s.target_weight,
        target_rpe: s.target_rpe,
        target_rir: s.target_rir,
        target_tempo: s.target_tempo,
        target_time_seconds: s.target_time_seconds,
        target_height: s.target_height,
        target_distance: s.target_distance,
        rep_min: s.rep_min,
        rep_max: s.rep_max,
      }));
      if (sets.length > 0) {
        await supabase.from("group_workout_exercise_sets").insert(sets);
      }
    }

    const notes = (w.workout_notes ?? []).map((n: any) => ({
      workout_id: newWorkout.id,
      group_id: destinationGroupId,
      body: n.body,
      position: n.position,
      created_by: createdBy,
    }));
    if (notes.length > 0) {
      await supabase.from("workout_notes").insert(notes);
    }
  }

  return { programId: newProgram.id };
}
