// Names a coach can type for an exercise that are DEFINITIVELY the same movement (pure). Merged with the coach's own saved aliases when the builder loads, so the name box finds "RFESS" and lists
// the Bulgarian split squat, and the row can then show the name the coach typed while staying linked to the one real exercise. Nothing is stored for these (no data load, no paste).
//
// The rule for this list: only names that mean EXACTLY the same exercise: another spelling, an abbreviation, or the other common name of one movement. Never a variation: a front-foot-elevated
// split squat, a goblet or dumbbell version, a different grip or stance is a different exercise and is never listed. A coach can add their own aliases in the usual way; those win over these.

import { canonicalKey } from "@/lib/exercise-normaliser";
import type { AliasEntry } from "@/lib/exercise-matching";

export interface AliasGroup {
  names: string[];
  why: string;
}

export const ALIAS_GROUPS: AliasGroup[] = [
  { names: ["Bulgarian Split Squat", "Rear Foot Elevated Split Squat", "RFESS", "RFE Split Squat"], why: "one exercise: split squat with the back foot on a bench; Bulgarian is the common name, RFESS the abbreviation" },
  { names: ["Romanian Deadlift", "RDL"], why: "abbreviation of the same lift" },
  { names: ["Overhead Press", "Barbell Overhead Press", "OHP"], why: "the standing barbell press overhead; OHP is the abbreviation (a dumbbell press is a different exercise and is not listed)" },
  { names: ["Stiff Leg Deadlift", "Straight Leg Deadlift", "SLDL"], why: "two names for the same straight-leg deadlift" },
  { names: ["Lat Pulldown", "Lat Pull Down", "Lat Pull-Down"], why: "spelling of the same machine exercise" },
  { names: ["Skull Crusher", "Lying Triceps Extension"], why: "two names for the same lying triceps extension" },
  { names: ["Pull-Up", "Pull Up", "Pullup"], why: "spelling only (a chin-up is a different grip and is not listed)" },
  { names: ["Chin-Up", "Chin Up", "Chinup"], why: "spelling only" },
  { names: ["Push-Up", "Push Up", "Pushup"], why: "spelling only" },
  { names: ["Back Squat", "Barbell Back Squat"], why: "the barbell back squat; the longer name says the same thing (front and goblet squats are different and are not listed)" },
  { names: ["Trap Bar Deadlift", "Hex Bar Deadlift"], why: "the same bar under two names" },
  { names: ["Glute Ham Raise", "GHR"], why: "abbreviation of the same exercise" },
  { names: ["Barbell Bench Press", "Bench Press"], why: "a bare bench press means the barbell flat press (dumbbell and incline versions are different and are not listed)" },
  { names: ["Face Pull", "Cable Face Pull"], why: "the face pull is the cable exercise; the longer name says the same thing" },
];

const key = (name: string): string => canonicalKey(name);

// The aliases that apply to this coach's library: for every group, each other name in it points at the library exercise that IS the group's movement. A name that already is a different exercise
// in the library is never shadowed, and a library with none of the group's names gets nothing from it.
export function seedAliasesFor(library: string[], groups: AliasGroup[] = ALIAS_GROUPS): AliasEntry[] {
  const libraryKeys = new Map<string, string>();
  for (const name of library) if (!libraryKeys.has(key(name))) libraryKeys.set(key(name), name);

  const libraryNames = new Set(library.map((n) => n.trim().toLowerCase()));
  const out: AliasEntry[] = [];
  for (const group of groups) {
    const present = group.names.filter((n) => libraryKeys.has(key(n)));
    if (present.length === 0) continue;
    // the library exercise the others point at: the first name of the group that the library has
    const target = libraryKeys.get(key(present[0]))!;
    for (const name of group.names) {
      // a name that is already an exercise in the library stays that exercise (spelled exactly as it is there)
      if (libraryNames.has(name.trim().toLowerCase())) continue;
      out.push({ rawName: name, exerciseName: target });
    }
  }
  return out;
}

// The coach's own saved aliases first, then the built-in ones that do not repeat a name the coach already saved.
export function mergeAliases(coachAliases: AliasEntry[], library: string[]): AliasEntry[] {
  const taken = new Set(coachAliases.map((a) => key(a.rawName)));
  return [...coachAliases, ...seedAliasesFor(library).filter((a) => !taken.has(key(a.rawName)))];
}

// What the coach typed, if it is one of the aliases (their own or built in) for an exercise in the library: the real exercise and the name to show. Null for a real exercise name or anything else.
export function resolveTypedAlias(typed: string, library: string[], aliases: AliasEntry[]): { exerciseName: string; displayName: string } | null {
  const t = typed.trim();
  if (!t) return null;
  const k = key(t);
  // a name that is exactly an exercise in the library is just that exercise, never an alias of another
  if (library.some((n) => n.trim().toLowerCase() === t.toLowerCase())) return null;
  const hit = aliases.find((a) => key(a.rawName) === k && library.includes(a.exerciseName));
  return hit ? { exerciseName: hit.exerciseName, displayName: hit.rawName } : null;
}
