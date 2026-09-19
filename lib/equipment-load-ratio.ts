// Per-client equipment-variant load-ratio learning
// (equipment_variant_load_ratio_and_smart_swap_scoping_sept19.md) — two
// exercise names sharing a movement_pattern_id but tagged with different
// exercise_library.equipment_type values (e.g. a machine leg press vs. a
// barbell variant under the same ladder) are candidate "variants." This
// file is the pure, deterministic math: given each variant's own logged-
// weight history for one athlete, estimate how their loads convert.
//
// Deliberately no AI/LLM here — this is closer to the ladder-picker's own
// backend query (a bounded, sorted lookup) than to "judgment." The only
// real design choice is robustness against noise: a single coincidental
// same-day pairing (an athlete who happens to log both variants once)
// shouldn't be trusted the way a real repeated pattern should.

export interface DatedWeight {
  sessionDate: string; // "YYYY-MM-DD" — the day this weight was logged
  weight: number;
}

// Same-day logging is this app's own existing granularity for "the same
// session" elsewhere (body_weight_logs, daily_macros are one row per
// day) — reused here rather than threading a session_id through, since
// a genuine same-day pairing of two different exercise names is already
// a strong, simple proxy for "logged in the same workout."
//
// Multiple sets of the same exercise on the same day collapse to that
// day's MAX weight (the real top working set, not diluted by warm-ups
// or backoff sets) before pairing — matches this app's existing bias
// toward peak/working weight elsewhere (training-max grounding, PR
// detection) rather than an average across a ramping scheme.
export function collapseToDailyMax(entries: DatedWeight[]): DatedWeight[] {
  const maxByDate = new Map<string, number>();
  for (const e of entries) {
    const current = maxByDate.get(e.sessionDate);
    if (current === undefined || e.weight > current) maxByDate.set(e.sessionDate, e.weight);
  }
  return [...maxByDate.entries()].map(([sessionDate, weight]) => ({ sessionDate, weight }));
}

// Pairs two variants' per-day top weights by matching session date and
// returns each pairing's own ratio (b's weight ÷ a's weight) — a list,
// not a single number, so the caller can take a robust median rather
// than trusting one noisy pairing.
export function computeVariantRatioSamples(historyA: DatedWeight[], historyB: DatedWeight[]): number[] {
  const dailyA = collapseToDailyMax(historyA);
  const dailyB = collapseToDailyMax(historyB);
  const weightByDateA = new Map(dailyA.map((d) => [d.sessionDate, d.weight]));

  const ratios: number[] = [];
  for (const b of dailyB) {
    const weightA = weightByDateA.get(b.sessionDate);
    if (weightA != null && weightA > 0 && b.weight > 0) {
      ratios.push(b.weight / weightA);
    }
  }
  return ratios;
}

export function medianRatio(ratios: number[]): number | null {
  if (ratios.length === 0) return null;
  const sorted = [...ratios].sort((x, y) => x - y);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 !== 0 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

// Don't suggest off a single coincidental same-day pairing — two real
// occurrences is the same "not just one noisy data point" bar the
// Programming Spotter's own redundancy checks already use (3, not 2,
// there; 2 here since this is a much narrower per-pair signal, not a
// whole-session pattern, and an athlete genuinely doing both variants
// on the same day even twice is already a real, repeated behavior).
export const MIN_SAMPLE_COUNT_FOR_RATIO = 2;

// Converts a known weight on `fromName` into a suggested weight on
// `toName`, using the stored (exercise_name_a, exercise_name_b, ratio)
// row — ratio is always defined as weight_b ÷ weight_a for whichever
// name sorts first alphabetically as "a". Direction-agnostic: works
// swapping either way between the stored pair.
export function convertWeightAcrossVariants(
  fromWeight: number,
  fromName: string,
  toName: string,
  row: { exerciseNameA: string; exerciseNameB: string; ratio: number }
): number | null {
  if (fromName === row.exerciseNameA && toName === row.exerciseNameB) {
    return Math.round(fromWeight * row.ratio);
  }
  if (fromName === row.exerciseNameB && toName === row.exerciseNameA) {
    return Math.round(fromWeight / row.ratio);
  }
  return null;
}
