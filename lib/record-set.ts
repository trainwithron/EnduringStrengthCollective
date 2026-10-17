import { estimateOneRepMax } from "@/lib/one-rep-max";

// A personal record is per number of reps: a set is a record when no earlier set was at least as heavy for at least as many reps. For the share card, which set of the session "earned" a record: among
// the session's sets, those no earlier set matched, and of those the strongest by estimated 1RM (the heavier one if tied). With no earlier sets, every set qualifies. Null when no set qualifies.
export interface WeightedSet {
  weight: number;
  reps: number;
}

export function pickRecordSet(sessionSets: WeightedSet[], priorSets: WeightedSet[]): WeightedSet | null {
  const earned = sessionSets.filter((s) => s.weight > 0 && !priorSets.some((p) => p.weight >= s.weight && p.reps >= s.reps));
  if (earned.length === 0) return null;
  const score = (s: WeightedSet) => estimateOneRepMax(s.weight, s.reps) ?? s.weight;
  return earned.reduce((best, s) => (score(s) > score(best) || (score(s) === score(best) && s.weight > best.weight) ? s : best));
}
