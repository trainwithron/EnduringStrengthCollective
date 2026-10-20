import { usableExerciseNames } from "@/lib/exercise-name-guard";
import { matchExercise, sameQualifiers } from "@/lib/exercise-matching";
import { capitalizeWords } from "@/lib/exercise-name-case";

// Quick-add is typed fast, so a bare "Bench" for an existing "Bench
// Press" is common — matchExercise's fuzzy threshold is deliberately
// conservative (avoids merging genuinely different exercises that share
// a word, e.g. "Barbell Bench Press" vs "Barbell Overhead Press"), which
// means a short real prefix like that doesn't cross it. This adds one
// narrower, safe fallback specifically for quick-add: if exactly one
// library exercise starts with what was typed, reuse it. When two or more
// start with it, nothing is guessed and nothing half-typed is saved ("Sumo S"):
// the coach is asked to type a little more.
// Shared by the program builder's quick add (day-card.tsx) and the wing-it logger (components/logging/wing-it-box.tsx).
export function resolveQuickAddExerciseName(typedName: string, fullLibrary: string[]): { name: string } | { ambiguous: string[] } {
  const library = usableExerciseNames(fullLibrary);
  const match = matchExercise(typedName, library.map((name) => ({ name })), []);
  // A near match is used only when it is the same movement with the same implement, side and position; what someone typed is never swapped for a different exercise.
  if (match.exerciseName && (match.confidence !== "fuzzy" || sameQualifiers(typedName, match.exerciseName))) return { name: match.exerciseName };

  const normalizedTyped = typedName.trim().toLowerCase();
  const prefixMatches = library.filter((name) => name.toLowerCase().startsWith(normalizedTyped));
  // A library exercise keeps its own casing; a brand-new typed name gets a capital on each word.
  if (prefixMatches.length === 1) return { name: prefixMatches[0] };
  if (prefixMatches.length > 1) return { ambiguous: prefixMatches.slice(0, 3) };
  return { name: capitalizeWords(typedName) };
}
