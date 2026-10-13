import type { Tier } from "@/lib/starter-ladders";

// "Sort my exercises": tagging the coach's library with a movement pattern, a side and a class so templates can pick from it. Rules first (a name that says "single leg" is one-sided), then an AI suggestion the coach
// confirms or edits. Nothing is saved until the coach confirms. Pure, so it is tested.

// Words in an exercise name that say it works one side at a time.
const UNILATERAL_WORDS = /\b(single[- ]?(leg|arm)|one[- ]?(leg|arm)|unilateral|split squat|lunge|step[- ]?up|bulgarian|pistol|suitcase|cossack|alternating|skater|renegade|meadows)\b/i;

export function looksUnilateral(name: string): boolean {
  return UNILATERAL_WORDS.test(name);
}

export interface Suggestion {
  name: string;
  pattern: string | null; // null = does not fit a strength pattern (cardio, mobility, jumps)
  unilateral: boolean;
  tier: Tier | null;
  level: number; // 1 (easy) to 5 (hard)
}

// Reads the model's answer: every item must name one of the exercises asked about; the pattern must be one the coach can choose; anything else is dropped to a safe blank. Never throws.
export function parseSuggestions(raw: unknown, asked: string[], patterns: string[]): Suggestion[] {
  const out: Suggestion[] = [];
  if (!Array.isArray(raw)) return out;
  const askedSet = new Map(asked.map((n) => [n.trim().toLowerCase(), n]));
  const valid = new Set(patterns);
  const seen = new Set<string>();
  for (const item of raw) {
    const r = item as Record<string, unknown>;
    const nameRaw = typeof r?.name === "string" ? r.name.trim().toLowerCase() : "";
    const name = askedSet.get(nameRaw);
    if (!name || seen.has(name)) continue;
    seen.add(name);
    const pattern = typeof r.pattern === "string" && valid.has(r.pattern) ? r.pattern : null;
    const tier = r.tier === "A" || r.tier === "B" || r.tier === "C" ? (r.tier as Tier) : null;
    const levelNum = typeof r.level === "number" && Number.isFinite(r.level) ? Math.round(r.level) : 3;
    out.push({
      name,
      pattern,
      unilateral: typeof r.unilateral === "boolean" ? r.unilateral : looksUnilateral(name),
      tier,
      level: Math.min(5, Math.max(1, levelNum)),
    });
  }
  return out;
}

// Where a newly confirmed exercise goes on a ladder, from its 1 to 5 level: spread across the ladder's current ranks (an empty ladder just uses the level).
export function rankForLevel(level: number, existingRanks: number[]): number {
  const l = Math.min(5, Math.max(1, Math.round(level)));
  if (existingRanks.length === 0) return l - 1;
  const lo = Math.min(...existingRanks);
  const hi = Math.max(...existingRanks);
  if (hi === lo) return l - 1 > 0 ? hi + 1 : lo;
  return Math.round(lo + ((l - 1) / 4) * (hi - lo));
}

// The exercises still to sort: library names that are on no pattern ladder and not skipped this visit.
export function unsortedNames(libraryNames: string[], sortedNames: Set<string>, skipped: Set<string>): string[] {
  return libraryNames.filter((n) => !sortedNames.has(n) && !skipped.has(n));
}

export function progressLine(sorted: number, total: number): string {
  return `${sorted} of ${total} sorted`;
}
