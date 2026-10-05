import type { SupabaseClient } from "@supabase/supabase-js";

export interface DuplicateProgramOptions {
  sourceProgramId: string;
  destinationGroupId: string;
  createdBy: string;
  // Personal copy for one client when set; a plain shared duplicate when
  // omitted. Every child row (workouts, exercises, sets, notes) inherits
  // this automatically via the set_workout_athlete_id/set_gwe_athlete_id/
  // set_workout_notes_athlete_id triggers — nothing else needs to set it.
  athleteId?: string;
  // Personal copies get a readable suffix; plain duplicates keep the
  // exact source name (the coach can rename either afterward).
  clientName?: string;
  // Overrides the copied start_date so the new copy's schedule is
  // correctly anchored from the moment it's actually assigned, rather
  // than inheriting whatever date the source program happened to start
  // on (very often already in the past by the time a program is copied
  // for a new client). training_days/visibility_window still copy as-is.
  startDate?: string;
}

// Deep-copies a whole program — every week/day, exercise, set (including
// rest/pace targets), progression rule (with its tier label) and note —
// into a brand-new, fully independent set of rows. The shared engine behind
// "Assign to Client" (athleteId set), the plain "Duplicate" action, the
// package auto-assign, and cross-organization copies (destinationGroupId in
// another org).
//
// The copy runs as ONE database function (migrations 0230/0232,
// public.duplicate_program), so it is all-or-nothing: any failure rolls the
// whole copy back and this returns { error }, never a half-copied program
// that reports success. The caller's row-level security applies as before.
// It never deactivates anything: a client can run several programs at once
// (main work, mobility, a warm-up flow), so replacing an old program is a
// separate, explicit choice.
export async function duplicateProgram(
  supabase: SupabaseClient,
  { sourceProgramId, destinationGroupId, createdBy, athleteId, clientName, startDate }: DuplicateProgramOptions
): Promise<{ programId: string } | { error: string }> {
  const { data, error } = await supabase.rpc("duplicate_program", {
    p_source_program_id: sourceProgramId,
    p_destination_group_id: destinationGroupId,
    p_created_by: createdBy,
    p_athlete_id: athleteId ?? null,
    p_client_name: clientName ?? null,
    p_start_date: startDate ?? null,
  });

  if (error || !data) {
    return { error: error?.message ?? "Couldn't create the duplicated program." };
  }
  return { programId: data as string };
}
