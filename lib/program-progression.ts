import type { SupabaseClient } from "@supabase/supabase-js";
import type { BuilderDay } from "@/lib/types";
import type { DoubleProgressionConfig } from "@/lib/progressions";

// Double progression for a whole program, chosen once inside the builder: a rep range (say 8 to 12) and a weight jump. It writes exactly what the engine already reads: one exercise_progressions row per exercise
// (model double_progression) and rep_min / rep_max on every set. Nothing new is invented here; the old Exercise Progressions page edits the same rows.
export interface DoubleSettings {
  low: number;
  high: number;
  increment: number;
}

export const DEFAULT_DOUBLE: DoubleSettings = { low: 8, high: 12, increment: 5 };

export function validateDouble(s: DoubleSettings): string | null {
  const whole = (n: number) => Number.isInteger(n);
  if (!whole(s.low) || !whole(s.high) || s.low < 1 || s.high > 100) return "Reps must be whole numbers from 1 to 100.";
  if (s.low >= s.high) return "The top of the rep range has to be higher than the bottom.";
  if (!Number.isFinite(s.increment) || s.increment <= 0 || s.increment > 100) return "The weight to add has to be more than 0 and no more than 100 lb.";
  return null;
}

// What it will do, in plain words. The engine looks at the heaviest set of the last time the exercise was done.
export function describeDouble(s: DoubleSettings): string {
  return `Everyone starts at ${s.low} reps. When they hit ${s.high} reps on their heaviest set, the weight goes up ${s.increment} lb and reps go back to ${s.low}.`;
}

export function doubleConfig(s: DoubleSettings): DoubleProgressionConfig {
  return { repRangeLow: s.low, repRangeHigh: s.high, weightIncrement: s.increment, unit: "lbs" };
}

// The real exercises in the program (not template slots), each once, in the order they first appear.
export function exerciseNamesOf(days: BuilderDay[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const d of days) {
    for (const item of d.items) {
      if (item.kind !== "exercise" || item.slot) continue;
      if (!seen.has(item.exerciseName)) {
        seen.add(item.exerciseName);
        out.push(item.exerciseName);
      }
    }
  }
  return out;
}

export function setIdsOf(days: BuilderDay[]): string[] {
  const ids: string[] = [];
  for (const d of days) for (const item of d.items) if (item.kind === "exercise" && !item.slot) for (const s of item.sets) ids.push(s.id);
  return ids;
}

export interface Rule {
  exercise_name: string;
  model: string;
  config: unknown;
}

export type ProgramProgression =
  | { kind: "none" }
  | { kind: "double"; settings: DoubleSettings; covered: number; total: number }
  | { kind: "mixed" };

// What the program's rules say as a whole: nothing; double progression with one setting on every exercise (or most of them); or a mix of settings and other models (left to the exercises themselves).
export function readProgramProgression(names: string[], rules: Rule[]): ProgramProgression {
  const mine = rules.filter((r) => names.includes(r.exercise_name));
  if (mine.length === 0) return { kind: "none" };
  const doubles = mine.filter((r) => r.model === "double_progression");
  if (doubles.length === mine.length) {
    const key = (r: Rule) => {
      const c = r.config as DoubleProgressionConfig;
      return `${c.repRangeLow}|${c.repRangeHigh}|${c.weightIncrement}`;
    };
    if (new Set(doubles.map(key)).size === 1) {
      const c = doubles[0].config as DoubleProgressionConfig;
      return { kind: "double", settings: { low: c.repRangeLow, high: c.repRangeHigh, increment: c.weightIncrement }, covered: doubles.length, total: names.length };
    }
  }
  return { kind: "mixed" };
}

function chunk<T>(list: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < list.length; i += size) out.push(list.slice(i, i + size));
  return out;
}

// Writes the rule for every named exercise and the rep range on every given set. Returns a plain error message, or null when everything saved.
export async function saveDouble(
  supabase: SupabaseClient,
  { programId, groupId, userId, names, setIds, settings }: { programId: string; groupId: string; userId: string; names: string[]; setIds: string[]; settings: DoubleSettings }
): Promise<string | null> {
  const invalid = validateDouble(settings);
  if (invalid) return invalid;
  if (names.length > 0) {
    const { error } = await supabase.from("exercise_progressions").upsert(
      names.map((exercise_name) => ({ program_id: programId, group_id: groupId, exercise_name, model: "double_progression", config: doubleConfig(settings), created_by: userId })),
      { onConflict: "program_id,exercise_name" }
    );
    if (error) return "Couldn't save the progression. Try again.";
  }
  for (const ids of chunk(setIds, 150)) {
    const { error } = await supabase.from("group_workout_exercise_sets").update({ rep_min: settings.low, rep_max: settings.high }).in("id", ids);
    if (error) return "Saved the progression, but the rep range didn't save on every set. Try again.";
  }
  return null;
}

// Removes the double-progression rules of the given exercises (a rule of another type is never touched here). The rep ranges on the sets are left as they are.
export async function clearDouble(supabase: SupabaseClient, { programId, names }: { programId: string; names: string[] }): Promise<string | null> {
  if (names.length === 0) return null;
  const { error } = await supabase.from("exercise_progressions").delete().eq("program_id", programId).eq("model", "double_progression").in("exercise_name", names);
  return error ? "Couldn't turn that off. Try again." : null;
}

// Applies a saved range to the builder's own copy of the sets so the screen matches the database.
export function withRange(days: BuilderDay[], low: number | null, high: number | null, onlyExercise?: string): BuilderDay[] {
  return days.map((d) => ({
    ...d,
    items: d.items.map((item) => (item.kind === "exercise" && !item.slot && (onlyExercise == null || item.exerciseName === onlyExercise) ? { ...item, sets: item.sets.map((s) => ({ ...s, repMin: low, repMax: high })) } : item)),
  }));
}
