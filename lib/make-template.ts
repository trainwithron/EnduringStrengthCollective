import type { SupabaseClient } from "@supabase/supabase-js";
import { getCoachedGroups, groupsInOrgOf, pickAnchorGroup } from "@/lib/coach-groups";
import { duplicateProgram, importRefusal, isImportRefusal } from "@/lib/program-duplication";
import { loadCoachLadders } from "@/lib/coach-ladders";
import { canonicalKey } from "@/lib/exercise-normaliser";
import { slotPlaceholderName, type Side, type SlotSpec, type SlotTier } from "@/lib/slot-templates";

// "Make a template" from a program (Ron, Oct 26: "if I have a program built, I should have the option to say make a template"; "movement pattern, A class, B class, C class ... the same program tailored
// to anyone"). The program is copied into the organization's library as "<Program> template"; in the copy, every exercise that is on one of the coach's ladders becomes a slot (that ladder's pattern,
// its side when the ladder marks it unilateral, else either side, and that rung's class), keeping its sets, reps, rest, effort, notes and place. An exercise on no ladder stays as it is. The original is
// never changed. Pure, so it is tested.

export interface LadderEntry {
  exerciseName: string;
  patternId: string;
  patternName: string;
  tier: SlotTier | null;
  unilateral: boolean;
}

export interface TemplateExercise {
  id: string;
  name: string;
}

export interface TemplatePlan {
  slots: { id: string; patternId: string; spec: SlotSpec; placeholder: string; from: string }[];
  fixed: string[];
  total: number;
}

export function templateName(programName: string): string {
  const name = programName.trim() || "Program";
  return /\btemplate$/i.test(name) ? name : `${name} template`;
}

// The ladder rung an exercise is on (same exercise spelled differently counts). On two ladders: the first, by pattern name, so the choice never flips.
export function ladderFor(name: string, ladders: LadderEntry[]): LadderEntry | null {
  const key = canonicalKey(name);
  if (!key) return null;
  const hits = ladders.filter((l) => canonicalKey(l.exerciseName) === key);
  return hits.length === 0 ? null : [...hits].sort((a, b) => a.patternName.localeCompare(b.patternName))[0];
}

export function planTemplate(exercises: TemplateExercise[], ladders: LadderEntry[]): TemplatePlan {
  const slots: TemplatePlan["slots"] = [];
  const fixed: string[] = [];
  for (const e of exercises) {
    const rung = ladderFor(e.name, ladders);
    if (!rung) {
      if (!fixed.includes(e.name)) fixed.push(e.name);
      continue;
    }
    const side: Side | null = rung.unilateral ? "unilateral" : null;
    const spec: SlotSpec = { patternName: rung.patternName, side, tier: rung.tier };
    slots.push({ id: e.id, patternId: rung.patternId, spec, placeholder: slotPlaceholderName(spec), from: e.name });
  }
  return { slots, fixed, total: exercises.length };
}

// "6 of 8 exercises became slots; Bench Press and Plank stayed as they are (not on a ladder yet)."
// Counted by exercise (a program repeats its exercises week after week), not by row.
export function templateSummary(plan: TemplatePlan): string {
  const n = new Set(plan.slots.map((s) => s.from)).size;
  const total = n + plan.fixed.length;
  const head = `${n} of ${total} ${total === 1 ? "exercise" : "exercises"} became ${n === 1 ? "a slot" : "slots"}`;
  if (plan.fixed.length === 0) return `${head}.`;
  const names = plan.fixed.length <= 4 ? joinNames(plan.fixed) : `${joinNames(plan.fixed.slice(0, 3))} and ${plan.fixed.length - 3} more`;
  return `${head}; ${names} stayed as ${plan.fixed.length === 1 ? "it is" : "they are"} (not on a ladder yet).`;
}

function joinNames(names: string[]): string {
  if (names.length <= 1) return names.join("");
  return `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}`;
}

// Nothing in the program is on a ladder: a template with no slots would be only a switched-off copy, so nothing is made.
export const NOTHING_TO_SLOT = "None of these exercises are on a movement ladder yet, so there is nothing to turn into slots. Add them to a ladder in the Exercise Library, or add a slot by hand.";

type ExerciseRow = { id: string; exercise_name: string; is_slot: boolean | null };
const exercisesOf = (rows: ExerciseRow[] | null): TemplateExercise[] => (rows ?? []).filter((r) => !r.is_slot).map((r) => ({ id: r.id, name: r.exercise_name }));

// Making it (in the browser, as the coach). All or nothing: if a step fails, the new template is deleted again; the original is never touched.

export async function makeTemplate(
  supabase: SupabaseClient,
  { programId, programName, groupId, coachId }: { programId: string; programName: string; groupId: string; coachId: string }
): Promise<{ programId: string; groupId: string; summary: string } | { error: string }> {
  // An import still being written is never made into a template (lib/program-duplication.ts).
  const refused = await importRefusal(supabase, programId);
  if (refused) return { error: refused };
  // The organization's library: where New program puts a program (its anchor group); a program outside any organization (the coach's own training) keeps its own place.
  const coached = await getCoachedGroups(supabase, coachId);
  const here = coached.find((g) => g.id === groupId);
  const anchor = here ? pickAnchorGroup(groupsInOrgOf(coached, groupId), null, here.orgId) : null;
  const libraryGroupId = anchor && anchor.kind !== "one_on_one" ? anchor.id : groupId;
  const inLibrary = !!anchor && anchor.kind !== "one_on_one";

  // The coach's own ladders; a coach with none gets the starter ladders first (lib/coach-ladders.ts). Read against the program itself first: when none of its exercises is on a ladder,
  // nothing is made.
  const [{ data: originalRows, error: originalError }, ladderRead] = await Promise.all([
    supabase.from("group_workout_exercises").select("id, exercise_name, is_slot, workouts!inner ( program_id )").eq("workouts.program_id", programId),
    loadCoachLadders(supabase, coachId),
  ]);
  if (originalError || "error" in ladderRead) return { error: "Couldn't make the template. Try again." };
  const added = ladderRead.addedStarters ? "Your starter movement ladders were added. " : "";
  if (planTemplate(exercisesOf(originalRows as ExerciseRow[] | null), ladderRead.ladders).slots.length === 0) return { error: `${added}${NOTHING_TO_SLOT}` };

  const copy = await duplicateProgram(supabase, { sourceProgramId: programId, destinationGroupId: libraryGroupId, createdBy: coachId });
  if ("error" in copy) return { error: isImportRefusal(copy.error) ? copy.error : "Couldn't make the template. Try again." };
  const undo = async () => {
    await supabase.from("programs").delete().eq("id", copy.programId);
  };
  const { error: nameError } = await supabase
    .from("programs")
    .update({ name: templateName(programName), is_active: false, ...(inLibrary ? { org_program: true } : {}) })
    .eq("id", copy.programId);
  if (nameError) {
    await undo();
    return { error: "Couldn't make the template. Try again." };
  }

  // The same plan, on the template's own rows.
  const { data: rows, error: rowsError } = await supabase.from("group_workout_exercises").select("id, exercise_name, is_slot, workouts!inner ( program_id )").eq("workouts.program_id", copy.programId);
  if (rowsError) {
    await undo();
    return { error: "Couldn't make the template. Try again." };
  }
  const plan = planTemplate(exercisesOf(rows as ExerciseRow[] | null), ladderRead.ladders);
  for (const s of plan.slots) {
    const { error } = await supabase
      .from("group_workout_exercises")
      .update({ is_slot: true, movement_pattern_id: s.patternId, slot_side: s.spec.side, slot_tier: s.spec.tier, exercise_name: s.placeholder, display_name: null })
      .eq("id", s.id);
    if (error) {
      await undo();
      return { error: "Couldn't make the template. Try again." };
    }
  }
  return { programId: copy.programId, groupId: libraryGroupId, summary: `${added}${templateSummary(plan)}` };
}
