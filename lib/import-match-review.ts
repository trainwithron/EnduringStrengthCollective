import { findLibraryVariant, normalizeName, type AliasEntry, type MatchConfidence } from "@/lib/exercise-matching";
import { canonicalKey } from "@/lib/exercise-normaliser";

// The import review's guessed exercises (Ron, Oct 26: "not all of these are 100percent matches"). A name the coach matched in an earlier import (their saved alias) is not a guess
// with a score: it says so, plainly. A guess the matcher is less than 90% sure of is never picked for the coach: they choose. Pure, so it is tested.
export const PRESELECT_AT = 0.9;

// The starting choice for a review row: false = use the match, null = nothing picked yet (the coach must choose).
export function preselectUseRaw(confidence: MatchConfidence, score: number): boolean | null {
  if (confidence === "alias") return false;
  return score >= PRESELECT_AT ? false : null;
}

export function matchLabel(row: { fromAlias?: boolean; score: number }): string {
  return row.fromAlias ? "you matched this before" : `${Math.round(row.score * 100)}% match`;
}

// The saved alias a name was matched by (as it is stored, so it can be removed when the coach turns the match down).
export function aliasRawNameFor(rawName: string, aliases: AliasEntry[]): string | null {
  const key = normalizeName(rawName);
  return aliases.find((a) => normalizeName(a.rawName) === key)?.rawName ?? null;
}

export function allMatchesChosen(rows: { useRaw: boolean | null }[]): boolean {
  return rows.every((r) => r.useRaw !== null);
}

// The exercise already in the library that a typed name IS (case, spacing, a plural, word order or a known abbreviation aside), so "Add it as its own new exercise" never makes a second
// copy of it (Ron, Oct 26: "suggesting that we add a different one that's a replica of the one we already have"): that choice then reads "Use your <name>" and uses that row.
export function libraryTwin(rawName: string, libraryNames: string[]): string | null {
  const key = normalizeName(rawName);
  const canon = canonicalKey(rawName);
  return findLibraryVariant(rawName, libraryNames) ?? libraryNames.find((n) => normalizeName(n) === key) ?? (canon ? libraryNames.find((n) => canonicalKey(n) === canon) ?? null : null);
}
