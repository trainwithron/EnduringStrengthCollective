import type { SupabaseClient } from "@supabase/supabase-js";

// An import is written one day at a time (components/coach/desktop/import-wizard.tsx). Until its last day is written it is marked programs.importing (0436), and nothing copies it: a copy made
// half-way has only the days written so far (Oct 26, Sawyer's copy had 29 of 49). One that is still marked long after it started never finished (the page was closed part-way).
export const STILL_IMPORTING = "Still importing. Try again in a moment.";
export const IMPORT_NOT_FINISHED = "This import did not finish. Import the program again.";
const UNFINISHED_AFTER_MS = 10 * 60 * 1000;

export function importRefusalFor(row: { importing?: boolean | null; created_at?: string | null } | null, now: number = Date.now()): string | null {
  if (row?.importing !== true) return null;
  const started = row.created_at ? Date.parse(row.created_at) : NaN;
  return Number.isFinite(started) && now - started > UNFINISHED_AFTER_MS ? IMPORT_NOT_FINISHED : STILL_IMPORTING;
}

export function isImportRefusal(message: string | null | undefined): boolean {
  return message === STILL_IMPORTING || message === IMPORT_NOT_FINISHED;
}

// Why this program cannot be copied yet, or null. A failed read is not a refusal: the copy itself then answers as before.
export async function importRefusal(supabase: SupabaseClient, programId: string): Promise<string | null> {
  try {
    const { data, error } = await supabase.from("programs").select("importing, created_at").eq("id", programId).maybeSingle();
    return error ? null : importRefusalFor(data as { importing?: boolean | null; created_at?: string | null } | null);
  } catch {
    return null;
  }
}

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
  const refused = await importRefusal(supabase, sourceProgramId);
  if (refused) return { error: refused };
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

// Assigning a program to ONE person (Ron, asked four times: "first person gets the original"). The FIRST person a library program goes to gets the program itself; everyone after gets their own
// independent copy (own progress, own edits, no overlap). The database decides (public.assign_program_to_client, migration 0424): it hands the program over only when nobody has it or a copy of it yet,
// it has no history, it is not a template with slots, and it stays inside one organization (so "Me", in the coach's personal space, which belongs to no organization, always gets a copy). The copy keeps
// the program's own name (no client name is added). A program that is an AI draft must be signed off first by the caller.
export async function assignProgramToClient(
  supabase: SupabaseClient,
  { sourceProgramId, destinationGroupId, athleteId, startDate }: { sourceProgramId: string; destinationGroupId: string; athleteId: string; startDate?: string }
): Promise<{ programId: string; attached: boolean } | { error: string }> {
  const refused = await importRefusal(supabase, sourceProgramId);
  if (refused) return { error: refused };
  const { data, error } = await supabase
    .rpc("assign_program_to_client", {
      p_program_id: sourceProgramId,
      p_destination_group_id: destinationGroupId,
      p_athlete_id: athleteId,
      p_client_name: null,
      p_start_date: startDate ?? null,
    })
    .single();
  const row = data as { assigned_program_id?: string | null; was_attached?: boolean | null } | null;
  if (error || !row?.assigned_program_id) return { error: error?.message ?? "Couldn't assign the program." };
  return { programId: row.assigned_program_id, attached: row.was_attached === true };
}
