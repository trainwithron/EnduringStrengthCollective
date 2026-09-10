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
  reps: number; // the actual rep target for this stage — typed in directly, no math
}

export interface UndulatingProgressionOptions {
  weeks: number;
  wave: UndulatingWaveStep[];
}

export const DEFAULT_UNDULATING_WAVE: UndulatingWaveStep[] = [
  { reps: 5 }, // heavy
  { reps: 8 }, // moderate
  { reps: 12 }, // light
];

// Weight stays exactly as it was on the source week — undulating here is
// purely a rep-target wave, not a weight progression.
export function generateUndulatingProgression(
  source: ProgressionSourceSet,
  options: UndulatingProgressionOptions
): ProgressionResultWeek[] {
  const results: ProgressionResultWeek[] = [];
  for (let i = 0; i < options.weeks; i++) {
    const step = options.wave[i % options.wave.length];
    results.push({ weight: source.weight, reps: step.reps });
  }
  return results;
}

// Interval/energy-system progression — a genuinely different shape than
// lifting's percentage-based weight compounding: a coach thinks in
// "add a round" or "cut 5 seconds of rest," not "+2.5%." A fixed
// per-week step (signed — negative for a decrease) on exactly one axis,
// holding the other two fixed.
export interface IntervalSourceSet {
  rounds: number;
  workSeconds: number;
  restSeconds: number;
}

export interface IntervalResultWeek {
  rounds: number;
  workSeconds: number;
  restSeconds: number;
}

export interface IntervalProgressionOptions {
  weeks: number;
  axis: "rounds" | "rest" | "work";
  amountPerWeek: number;
}

export function generateIntervalProgression(
  source: IntervalSourceSet,
  options: IntervalProgressionOptions
): IntervalResultWeek[] {
  const results: IntervalResultWeek[] = [];
  let rounds = source.rounds;
  let workSeconds = source.workSeconds;
  let restSeconds = source.restSeconds;

  for (let i = 0; i < options.weeks; i++) {
    if (options.axis === "rounds") {
      rounds = Math.max(1, Math.round(rounds + options.amountPerWeek));
    } else if (options.axis === "rest") {
      restSeconds = Math.max(0, restSeconds + options.amountPerWeek);
    } else {
      workSeconds = Math.max(0, workSeconds + options.amountPerWeek);
    }
    results.push({ rounds, workSeconds, restSeconds });
  }
  return results;
}

// Same convention as the reps-parsing helper already shared between the
// builder and the session logger (lib/program-card-visuals.ts's
// parseNumericReps) — pace is stored as free text so a coach can type a
// real pace ("9:00" min:sec, or a plain number of seconds) or an effort
// label ("easy"); only the two numeric shapes parse, so progression can
// silently no-op on a label instead of crashing or corrupting it.
export function parseNumericPaceSecondsPerUnit(text: string | null): number | null {
  if (!text) return null;
  const trimmed = text.trim();
  const clockMatch = trimmed.match(/^(\d+):([0-5]?\d)$/);
  if (clockMatch) {
    return Number(clockMatch[1]) * 60 + Number(clockMatch[2]);
  }
  const n = Number(trimmed);
  return Number.isFinite(n) ? n : null;
}

// The inverse — writes a progressed pace value back as free text in the
// same "M:SS" shape a coach would have typed, rather than leaving it as
// a bare number of seconds.
export function formatPaceSecondsToClock(totalSeconds: number): string {
  const rounded = Math.max(0, Math.round(totalSeconds));
  const minutes = Math.floor(rounded / 60);
  const seconds = rounded % 60;
  return `${minutes}:${String(seconds).padStart(2, "0")}`;
}
