// Pure week-over-week progression math for "duplicate this week with a
// progression model." Each function takes one exercise's source-week
// targets and returns the computed targets for every generated week that
// follows — the caller is responsible for actually writing new
// workouts/exercises/sets rows from this output.

export interface ProgressionSourceSet {
  weight: number | null;
  reps: number | null;
  repMin: number | null;
  repMax: number | null;
}

export interface ProgressionResultWeek {
  weight: number | null;
  reps: number | null;
}

// Rounds to the nearest plate-friendly increment (default 2.5 lbs) —
// raw percentage math otherwise produces targets like "137.8 lbs."
export function roundToIncrement(value: number, increment = 2.5): number {
  return Math.round(value / increment) * increment;
}

export interface LinearProgressionOptions {
  weeks: number;
  weightPctIncreasePerWeek: number;
  // Optional repeating rep sequence (e.g. [5, 8, 12]) applied across the
  // generated weeks instead of holding reps constant. Weight still
  // compounds every week regardless of where the rep cycle is.
  repCycle?: number[];
}

export function generateLinearProgression(
  source: ProgressionSourceSet,
  options: LinearProgressionOptions
): ProgressionResultWeek[] {
  const results: ProgressionResultWeek[] = [];
  let weight = source.weight;
  for (let i = 0; i < options.weeks; i++) {
    if (weight != null) {
      weight = roundToIncrement(weight * (1 + options.weightPctIncreasePerWeek / 100));
    }
    const reps =
      options.repCycle && options.repCycle.length > 0
        ? options.repCycle[i % options.repCycle.length]
        : source.reps;
    results.push({ weight, reps });
  }
  return results;
}

export interface DoubleProgressionOptions {
  weeks: number;
  weightBumpPct: number;
}

// Adds one rep per week while under the rep-range ceiling; once it hits
// the ceiling, resets to the floor and bumps weight instead. Requires a
// real rep_min/rep_max on the source set — without one, reps/weight just
// carry forward unchanged (nothing to trigger a reset against).
export function generateDoubleProgression(
  source: ProgressionSourceSet,
  options: DoubleProgressionOptions
): ProgressionResultWeek[] {
  const results: ProgressionResultWeek[] = [];
  let weight = source.weight;
  let reps = source.reps;
  const { repMin, repMax } = source;
  const hasRange = repMin != null && repMax != null;

  for (let i = 0; i < options.weeks; i++) {
    if (hasRange && reps != null && reps < repMax!) {
      reps = reps + 1;
    } else if (hasRange) {
      reps = repMin!;
      if (weight != null) weight = roundToIncrement(weight * (1 + options.weightBumpPct / 100));
    }
    results.push({ weight, reps });
  }
  return results;
}

export interface UndulatingWaveStep {
  weightPct: number; // relative to the source week's weight, e.g. 105 = 105%
  repDelta: number; // added to the source week's reps
}

export interface UndulatingProgressionOptions {
  weeks: number;
  wave: UndulatingWaveStep[];
}

export const DEFAULT_UNDULATING_WAVE: UndulatingWaveStep[] = [
  { weightPct: 105, repDelta: -2 }, // heavy
  { weightPct: 100, repDelta: 0 }, // moderate
  { weightPct: 90, repDelta: 3 }, // light
];

export function generateUndulatingProgression(
  source: ProgressionSourceSet,
  options: UndulatingProgressionOptions
): ProgressionResultWeek[] {
  const results: ProgressionResultWeek[] = [];
  for (let i = 0; i < options.weeks; i++) {
    const step = options.wave[i % options.wave.length];
    const weight = source.weight != null ? roundToIncrement((source.weight * step.weightPct) / 100) : null;
    const reps = source.reps != null ? Math.max(1, source.reps + step.repDelta) : null;
    results.push({ weight, reps });
  }
  return results;
}
