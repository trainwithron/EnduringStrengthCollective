// The live dropdown under the exercise-name box (pure). As the coach types, it lists the library exercises whose name, or one of whose learned aliases, matches what they typed,
// anywhere in the name (not just the start), best matches first. The ranking, best to worst:
//   0  the whole name (or alias) is exactly what was typed
//   1  the name (or alias) starts with what was typed
//   2  every typed word starts a word in the name (any order): "split bulg" finds "Bulgarian split squat"
//   3  what was typed appears inside a word or across words: "ulgar"
//   4  the words overlap enough to be a near miss (the importer's own fuzzy score)
// Ties keep the order the library was given in, which the page sorts most-used first, so a coach's usual exercises come up ahead of rarely used ones.

import { normalizeName, type AliasEntry } from "@/lib/exercise-matching";

export interface ExerciseSearchResult {
  name: string;
  // The alias the coach's text matched, when it matched an alias and not the name itself ("RFESS" for "Bulgarian split squat"); null when the name itself matched.
  viaAlias: string | null;
  tier: 0 | 1 | 2 | 3 | 4;
}

export const DROPDOWN_LIMIT = 8;
const FUZZY_FLOOR = 0.3;

const plain = (s: string): string =>
  s
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();

function jaccard(a: string, b: string): number {
  const sa = new Set(a.split(" ").filter(Boolean));
  const sb = new Set(b.split(" ").filter(Boolean));
  if (sa.size === 0 || sb.size === 0) return 0;
  let both = 0;
  for (const t of sa) if (sb.has(t)) both++;
  return both / new Set([...sa, ...sb]).size;
}

// How well one piece of text (an exercise name or an alias) matches the typed text, or null for no match.
function tierOf(typed: string, text: string): 0 | 1 | 2 | 3 | 4 | null {
  const t = plain(text);
  if (!t) return null;
  if (t === typed) return 0;
  if (t.startsWith(typed)) return 1;
  const words = t.split(" ");
  const typedWords = typed.split(" ");
  if (typedWords.every((tw) => words.some((w) => w.startsWith(tw)))) return 2;
  if (t.includes(typed)) return 3;
  if (jaccard(normalizeName(typed), normalizeName(text)) >= FUZZY_FLOOR) return 4;
  return null;
}

export function searchExercises(query: string, library: string[], aliases: AliasEntry[], limit: number = DROPDOWN_LIMIT): ExerciseSearchResult[] {
  const typed = plain(query);
  if (!typed) return [];

  const inLibrary = new Set(library);
  const aliasesByName = new Map<string, string[]>();
  for (const a of aliases) {
    if (!inLibrary.has(a.exerciseName)) continue;
    const list = aliasesByName.get(a.exerciseName) ?? [];
    list.push(a.rawName);
    aliasesByName.set(a.exerciseName, list);
  }

  const found: { result: ExerciseSearchResult; order: number }[] = [];
  library.forEach((name, order) => {
    let best: ExerciseSearchResult | null = null;
    const nameTier = tierOf(typed, name);
    if (nameTier !== null) best = { name, viaAlias: null, tier: nameTier };
    for (const alias of aliasesByName.get(name) ?? []) {
      const t = tierOf(typed, alias);
      // an alias only beats the name when it matches strictly better, so a name match is never shown as an alias match
      if (t !== null && (best === null || t < best.tier)) best = { name, viaAlias: alias, tier: t };
    }
    if (best) found.push({ result: best, order });
  });

  found.sort((a, b) => a.result.tier - b.result.tier || a.order - b.order);
  return found.slice(0, limit).map((f) => f.result);
}

// Whether the typed text is already an exercise in the library (by name, ignoring case and punctuation), so the "Add as a new exercise" row is not offered for something that exists.
export function isExistingExercise(query: string, library: string[]): boolean {
  const typed = plain(query);
  return typed !== "" && library.some((n) => plain(n) === typed);
}

// Arrow-key movement through the rows, with the "Add" row counted as the last. -1 means nothing highlighted (the typed text is what Enter commits).
export function nextActiveIndex(key: "ArrowDown" | "ArrowUp", active: number, rowCount: number): number {
  if (rowCount <= 0) return -1;
  if (key === "ArrowDown") return active >= rowCount - 1 ? 0 : active + 1;
  return active <= 0 ? rowCount - 1 : active - 1;
}

// Orders a library most-used first (then A to Z) from a count of how often each name is used.
export function sortByUsage(names: string[], usage: Map<string, number>): string[] {
  return [...names].sort((a, b) => (usage.get(b) ?? 0) - (usage.get(a) ?? 0) || a.localeCompare(b));
}
