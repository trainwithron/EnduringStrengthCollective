import type { SupabaseClient } from "@supabase/supabase-js";
import type { ImportedWeek } from "@/lib/workout-import-parser";
import type { TrackedField } from "@/lib/exercise-fields";
import type { GzclpProgressionRule } from "@/lib/gzclp-generator";
import { normalizeName } from "@/lib/exercise-matching";
import { detectTrainingIntent } from "@/lib/training-intent";
import { bestEffort } from "@/lib/saved";

// Writing an import to the database (components/coach/desktop/import-wizard.tsx, after the review). It makes a new program, or, when the import was started inside a program's builder and that
// program has no days yet, fills THAT program (Ron, Oct 27: "whenever you import a program, it should only import one, so there's not an empty one left behind"; "Build program" makes the empty
// program first, and the import used to make a second one beside it).

export const ALREADY_HAS_DAYS = "This program already has days, so the import is made as a new program.";
export const FILL_FAILED = "The import didn't finish, so nothing was added to this program. Try again.";

/** The name "Build program" / "New program" gives a program by itself (components/coach/create-and-open-program.tsx); any other name was typed by the coach and is kept. */
export function isAutomaticProgramName(name: string, athleteFullName: string | null): boolean {
  const n = name.trim();
  if (n === "New program") return true;
  const first = (athleteFullName ?? "").trim().split(/\s+/)[0] || "Client";
  return n === `${first}'s program`;
}

/** The program the import was started in: filled when it has no days yet. */
export interface OpenProgram {
  id: string;
  // Replaced by the import's name when it is still the automatic one.
  automaticName: boolean;
}

export interface WriteImportInput {
  groupId: string;
  coachId: string;
  athleteId: string | null;
  orgProgram: boolean;
  programName: string;
  description: string | null;
  isAiSourced: boolean;
  startDate: string | null;
  trainingDays: number[] | null;
  sequencingNotes: string | null;
  weeks: ImportedWeek[];
  resolutions: Map<string, { exerciseName: string; trackedFields: TrackedField[] }>;
  progressionRules?: GzclpProgressionRule[];
  openProgram?: OpenProgram | null;
}

export type WriteImportResult =
  | { error: string }
  | {
      programId: string;
      // True when the import filled the program it was started in.
      filled: boolean;
      failedWrites: number;
      finished: boolean;
      aiSnapshot: { week: number; day: number; order: number; name: string; sets: number; reps: string | null }[];
      notices: string[];
    };

// The program fields an import sets, read before it fills an opened program so a failed import can put them back.
const FILLED_FIELDS = "name, description, is_active, importing, ai_draft, start_date, training_days, visibility_window, ai_sequencing_notes, training_intent";

export async function writeImportedProgram(supabase: SupabaseClient, input: WriteImportInput): Promise<WriteImportResult> {
  const notices: string[] = [];
  const name = input.programName || "Imported Program";
  // Written one day at a time from here, so it starts switched off and marked as importing: nothing can assign, duplicate or make a template of it until the last day is written
  // (programs.importing, 0436; a copy made half-way had only the days written so far). It is switched on below, after the last day.
  const fields = {
    description: input.description,
    is_active: false,
    importing: true,
    ai_draft: input.isAiSourced,
    start_date: input.startDate,
    training_days: input.trainingDays,
    visibility_window: "day",
    ai_sequencing_notes: input.sequencingNotes,
  };

  let programId: string | null = null;
  let before: Record<string, unknown> | null = null;
  if (input.openProgram) {
    // Only a program with no days is filled (checked now, not only when the panel opened); one with days gets a new program, as before.
    const { count, error: countError } = await supabase.from("workouts").select("id", { count: "exact", head: true }).eq("program_id", input.openProgram.id);
    if (countError) return { error: "Couldn't create the program — try again." };
    if ((count ?? 0) === 0) {
      const { data: row, error: readError } = await supabase.from("programs").select(FILLED_FIELDS).eq("id", input.openProgram.id).maybeSingle();
      if (readError || !row) return { error: "Couldn't create the program — try again." };
      before = row as Record<string, unknown>;
      const { data: claimed, error: claimError } = await supabase
        .from("programs")
        .update({ ...fields, ...(input.openProgram.automaticName ? { name, training_intent: detectTrainingIntent(name) } : {}) })
        .eq("id", input.openProgram.id)
        .select("id")
        .maybeSingle();
      if (claimError || !claimed) return { error: "Couldn't create the program — try again." };
      programId = input.openProgram.id;
    } else {
      notices.push(ALREADY_HAS_DAYS);
    }
  }
  if (!programId) {
    const { data: programRow, error: programError } = await supabase
      .from("programs")
      .insert({
        group_id: input.groupId,
        created_by: input.coachId,
        // Personal-program mode (injury_pain_science_research_and_ai_gap_sept15.md): null for the plain group-level flow.
        athlete_id: input.athleteId,
        ...(input.orgProgram && !input.athleteId ? { org_program: true } : {}),
        name,
        ...fields,
        training_intent: detectTrainingIntent(name),
      })
      .select("id")
      .single();
    if (programError || !programRow) return { error: "Couldn't create the program — try again." };
    programId = programRow.id as string;
  }
  const filled = before !== null;

  // dup_gzclp_build_spec_sept15.md §1.3 point 2: only a GZCLP-generated program has rules.
  const ruleIds: string[] = [];
  if (input.progressionRules && input.progressionRules.length > 0) {
    // The rule is filed under the exercise's name as it was saved (matched to the library), or it would never find its exercise.
    const { data: rules, error: ruleError } = await supabase
      .from("exercise_progressions")
      .insert(
        input.progressionRules.map((rule) => ({
          program_id: programId,
          group_id: input.groupId,
          exercise_name: input.resolutions.get(normalizeName(rule.exerciseName))?.exerciseName ?? rule.exerciseName,
          model: rule.model,
          config: rule.config,
          tier_label: rule.tierLabel,
          created_by: input.coachId,
        }))
      )
      .select("id");
    if (ruleError) notices.push("The progression rules did not save. Open the program and set them again.");
    else for (const r of (rules ?? []) as { id: string }[]) ruleIds.push(r.id);
  }

  // Finalizing an import never deactivates the client's other programs: several programs can be active at once, activation is per program.
  let failedWrites = 0;
  const writtenDays: string[] = [];
  // What the AI wrote, kept on the draft so that when the coach signs it off the app can quietly see what they changed (see /api/ai/sign-off).
  const aiSnapshot: { week: number; day: number; order: number; name: string; sets: number; reps: string | null }[] = [];
  for (const week of input.weeks) {
    for (let dayIndex = 0; dayIndex < week.days.length; dayIndex++) {
      const day = week.days[dayIndex];
      const { data: workoutRow, error: workoutError } = await supabase
        .from("workouts")
        .insert({ program_id: programId, group_id: input.groupId, title: day.dayLabel, week_number: week.weekNumber, day_index: dayIndex + 1 })
        .select("id")
        .single();
      if (!workoutRow || workoutError) {
        failedWrites += Math.max(1, day.exercises.length);
        continue;
      }
      writtenDays.push(workoutRow.id as string);

      for (let exIndex = 0; exIndex < day.exercises.length; exIndex++) {
        const ex = day.exercises[exIndex];
        const resolution = input.resolutions.get(normalizeName(ex.exerciseName));
        if (!resolution) continue;
        const { data: exerciseRow, error: exerciseError } = await supabase
          .from("group_workout_exercises")
          .insert({
            workout_id: workoutRow.id,
            group_id: input.groupId,
            exercise_name: resolution.exerciseName,
            exercise_order: exIndex,
            tracked_fields: resolution.trackedFields,
            ...(ex.note ? { notes: ex.note } : {}),
          })
          .select("id")
          .single();
        if (!exerciseRow || exerciseError) {
          failedWrites += 1;
          continue;
        }
        const setsPayload = Array.from({ length: Math.max(1, ex.sets) }, (_, setOrder) => ({
          group_workout_exercise_id: exerciseRow.id,
          set_order: setOrder,
          target_reps: ex.reps,
          target_weight: ex.weight,
          target_rpe: ex.rpe,
          target_time_seconds: ex.timeSeconds,
          target_rest_seconds: ex.restSeconds ?? null,
        }));
        const { error: setsError } = await supabase.from("group_workout_exercise_sets").insert(setsPayload);
        if (setsError) failedWrites += 1;
        else aiSnapshot.push({ week: week.weekNumber, day: dayIndex + 1, order: exIndex, name: resolution.exerciseName, sets: setsPayload.length, reps: ex.reps });
      }
    }
  }

  // Into the program the coach opened, an import that did not write everything takes back only what it wrote (its days, with their exercises and sets, and its rules) and leaves the program
  // as it was, empty, to import into again. A new program keeps what was written and says what did not save, as before.
  if (filled && failedWrites > 0) {
    await undoFill(supabase, programId, writtenDays, ruleIds, before!);
    return { error: FILL_FAILED };
  }

  // Every day is written: the import is finished. A program the AI built is a DRAFT: not active, not seen by any client, until the coach signs it off in the builder. Anything else
  // (a spreadsheet, a pasted program the coach wrote) is switched on now.
  let finished = false;
  for (let attempt = 0; attempt < 3 && !finished; attempt++) {
    finished = await bestEffort(supabase.from("programs").update({ importing: false, is_active: !input.isAiSourced }).eq("id", programId));
  }
  if (!finished) {
    if (filled) {
      await undoFill(supabase, programId, writtenDays, ruleIds, before!);
      return { error: FILL_FAILED };
    }
    notices.push("The program was written but did not finish saving, so it can't be assigned yet. Import it again.");
  }
  return { programId, filled, failedWrites, finished, aiSnapshot, notices };
}

async function undoFill(supabase: SupabaseClient, programId: string, days: string[], ruleIds: string[], before: Record<string, unknown>) {
  // Deleting a day deletes its exercises and their sets (on delete cascade).
  if (days.length > 0) await bestEffort(supabase.from("workouts").delete().in("id", days));
  if (ruleIds.length > 0) await bestEffort(supabase.from("exercise_progressions").delete().in("id", ruleIds));
  await bestEffort(supabase.from("programs").update(before).eq("id", programId));
}
