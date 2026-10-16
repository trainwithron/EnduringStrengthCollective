import { parseQuickEntry } from "@/lib/quick-entry";
import { capitalizeWords } from "@/lib/exercise-name-case";
// An exercise name that is only digits, commas, dots and spaces ("1", "8,8,8", "20", "5,5,5", "12.5") is never a name: it is a counter, a rep list or a weight that landed in the wrong column. Imports stop
// on such a name instead of creating a program of exercises called "1", "2" and "3", and nothing like it is ever added to the library or the aliases. Pure.
const NUMERIC_ONLY = /^[0-9.,\s]+$/;

export function isNumericOnlyName(name: string | null | undefined): boolean {
  const text = (name ?? "").trim();
  return text.length > 0 && NUMERIC_ONLY.test(text) && /[0-9]/.test(text);
}

// The names in a list that are only numbers, once each, in the order they first appear.
export function numericOnlyNames(names: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of names) {
    const name = (raw ?? "").trim();
    if (isNumericOnlyName(name) && !seen.has(name)) {
      seen.add(name);
      out.push(name);
    }
  }
  return out;
}

export const NUMERIC_NAMES_MESSAGE = "The exercise column looks like numbers, not names. Pick the column with the exercise names.";

// FitPros history: lines that look like sets (or reps), not exercise names, and could not be attached to an exercise.
export function fitprosLayoutMessage(lines: string[]): string {
  const shown = lines.slice(0, 5).join("; ");
  return `These lines look like sets, not exercise names: ${shown}${lines.length > 5 ? ` and ${lines.length - 5} more` : ""}. The file may be laid out wrongly (each exercise should be one line: name | reps | weights).`;
}

// More than about a tenth of the exercises with no sets (and no note) means the layout was probably misread.
export const NO_SETS_SHARE = 0.1;

export function noSetsWarning(withoutSets: number, total: number): string | null {
  if (total === 0 || withoutSets / total <= NO_SETS_SHARE) return null;
  return `${withoutSets} of ${total} exercises have no sets. Check the file layout.`;
}

// A name that carries its prescription ("Sumo Squat 3x10", "Bench 3 x 8-12", "Squat 3 sets", "Row @7", "Squat 10 reps") is an exercise AND its sets, not an exercise name. It is split when typed and never kept as a
// library name. The same pattern is the database rule on exercise_library.name (0377): keep the two in step. A plain "21s", "5/3/1", "Day 1", "10x10" style name stays safe unless it really has n x m in it ("10x10" does).
const SETS_X_REPS = /\d+\s*[x×]\s*\d+/i;
const SETS_WORD = /\d+\s*sets?\b/i;
const REPS_AT_END = /\d+\s*reps?\s*$/i;
const AT_RPE = /@\s*\d[\d.]*\s*$/; // only a trailing RPE ("Row @7"); "Pause Squat @ 3 sec" is a real name

export function isPrescriptionName(name: string | null | undefined): boolean {
  const text = (name ?? "").trim();
  return SETS_X_REPS.test(text) || SETS_WORD.test(text) || REPS_AT_END.test(text) || AT_RPE.test(text);
}

export const PRESCRIPTION_MESSAGE = "That looks like sets and reps, not an exercise name.";

// A name that must never be added to the library or the aliases, or offered as a suggestion.
export function isBadExerciseName(name: string | null | undefined): boolean {
  return isNumericOnlyName(name) || isPrescriptionName(name);
}

export function badExerciseNameMessage(name: string): string {
  return isNumericOnlyName(name) ? "A name made only of numbers can't be added to your library." : PRESCRIPTION_MESSAGE;
}

export const OLD_JUNK_ROW_MESSAGE = "That change didn't save. This exercise is named with only numbers or with sets and reps, so it can't be edited. Remove it and add it again with a real name.";

// A database refusal of such a name, said in plain words; any other message is passed on unchanged.
export function friendlyDbError(message: string): string {
  return /exercise_(library_name_not_digits|aliases_target_not_digits)/.test(message) ? OLD_JUNK_ROW_MESSAGE : message;
}

export function usableExerciseNames(names: string[]): string[] {
  return names.filter((n) => !isBadExerciseName(n));
}

export interface SplitName {
  name: string;
  sets: number;
  reps: string | null;
  timeSeconds: number | null;
  rpe: number | null;
}

// "sumo squat 3x10" -> the name and the sets, read exactly as the Quick add box reads it. Null when the text is a prescription the Quick add reader cannot read (the caller then refuses it).
export function splitPrescriptionName(text: string): SplitName | null {
  if (!isPrescriptionName(text)) return null;
  const parsed = parseQuickEntry(text);
  if (!parsed || isBadExerciseName(parsed.exerciseName)) return null;
  return { name: capitalizeWords(parsed.exerciseName.trim()), sets: parsed.sets, reps: parsed.reps, timeSeconds: parsed.timeSeconds, rpe: parsed.rpe };
}

// The one cleaning and checking every writer of an exercise name uses (a program day, a logged session, an import): spaces tidied, and a name that is empty, only numbers, or carrying sets and reps refused with a plain message.
export function cleanExerciseName(raw: string | null | undefined): string {
  return (raw ?? "").replace(/\s+/g, " ").trim();
}

export function exerciseNameProblem(raw: string | null | undefined): string | null {
  const name = cleanExerciseName(raw);
  if (!name) return "Give the exercise a name.";
  return isBadExerciseName(name) ? badExerciseNameMessage(name) : null;
}
