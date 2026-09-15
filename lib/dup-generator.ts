import type { ParsedImportRow } from "./workout-import-parser";
import type { WaveConfig } from "./progressions";

// dup_gzclp_build_spec_sept15.md, step 2 of the build order — DUP Path
// A: a pure, deterministic generator (no LLM call) producing the exact
// same ParsedImportRow[] shape the AI/CSV/photo import paths already
// produce, so it can feed the *existing* prepareImport() review
// pipeline unchanged. No new review/write pipeline, no new database
// primitive — this is the "zero new primitives" claim made concrete.
//
// The 3-day rotation below is *a* defensible, commonly-cited DUP
// scheme (Rhea 2002 lineage), not "the" canonical DUP — there is no
// single official numbers table (see the spec's own honest caveat).
// Every session trains every lift in the roster at that day's
// intensity/rep target — the standard full-body DUP shape, where a
// single lift rotates through all three schemes across the week
// rather than being assigned to one day only.
export interface DupSessionScheme {
  label: string;
  sets: number;
  reps: string;
  // Percentage of the athlete's persisted training-max estimate
  // (athlete_training_maxes.estimated_max) this session's weight is
  // computed from.
  percentOfTrainingMax: number;
  // A single representative rep count for this day, for Path B's
  // dynamic wave_from_training_max config (lib/progressions.ts) — the
  // progression engine's repsPattern needs a real number per occurrence,
  // not the descriptive range shown in the static template.
  repsTarget: number;
}

export const DUP_WEEKLY_SCHEME: DupSessionScheme[] = [
  { label: "Hypertrophy", sets: 4, reps: "10-12", percentOfTrainingMax: 0.7, repsTarget: 11 },
  { label: "Strength", sets: 4, reps: "3-5", percentOfTrainingMax: 0.875, repsTarget: 4 },
  { label: "Power / Moderate", sets: 3, reps: "6-8", percentOfTrainingMax: 0.775, repsTarget: 7 },
];

export interface DupLiftInput {
  exerciseName: string;
  // athlete_training_maxes.estimated_max for this exercise — the
  // caller is responsible for only including lifts the athlete has a
  // real, persisted estimate for (never invented).
  trainingMax: number;
}

export interface DupGeneratorInput {
  lifts: DupLiftInput[];
  weeksToGenerate: number;
  // Weight rounds to the nearest multiple of this — real gyms don't
  // load fractional-pound plates. 5 for lbs, 2.5 for kg.
  roundToNearest?: number;
}

// Pure — no I/O, no randomness, same inputs always produce the same
// program. weeksToGenerate/lifts validated by the caller (a UI entry
// point), not here — this stays a plain data transform.
export function generateDupProgram({
  lifts,
  weeksToGenerate,
  roundToNearest = 5,
}: DupGeneratorInput): ParsedImportRow[] {
  const rows: ParsedImportRow[] = [];

  for (let week = 1; week <= weeksToGenerate; week++) {
    DUP_WEEKLY_SCHEME.forEach((scheme, dayIndex) => {
      for (const lift of lifts) {
        const rawWeight = lift.trainingMax * scheme.percentOfTrainingMax;
        const weight = Math.round(rawWeight / roundToNearest) * roundToNearest;
        rows.push({
          week: String(week),
          day: `Day ${dayIndex + 1} — ${scheme.label}`,
          exerciseName: lift.exerciseName,
          sets: scheme.sets,
          reps: scheme.reps,
          weight,
          rpe: null,
          rest: null,
          timeSeconds: null,
        });
      }
    });
  }

  return rows;
}

export interface DupProgressionRule {
  exerciseName: string;
  model: "wave_from_training_max";
  config: WaveConfig;
  tierLabel: string;
}

export interface DupSelfUpdatingResult {
  rows: ParsedImportRow[];
  progressionRules: DupProgressionRule[];
}

// dup_gzclp_build_spec_sept15.md §2.3 Path B — same 3-day rotation as
// Path A above, but no weight is ever baked into the shell (every row
// gets weight: null, even week 1). Instead, one wave_from_training_max
// exercise_progressions rule per lift drives every occurrence forever,
// reading the athlete's CURRENT training max fresh each time — no
// "regenerate to pick up a new PR" step, unlike Path A. Reuses the
// exact same DUP_WEEKLY_SCHEME numbers as Path A so the two paths never
// silently disagree about what "DUP" means in this app.
export function generateDupSelfUpdatingProgram({
  lifts,
  weeksToGenerate,
}: {
  lifts: DupLiftInput[];
  weeksToGenerate: number;
}): DupSelfUpdatingResult {
  const rows: ParsedImportRow[] = [];

  for (let week = 1; week <= weeksToGenerate; week++) {
    DUP_WEEKLY_SCHEME.forEach((scheme, dayIndex) => {
      for (const lift of lifts) {
        rows.push({
          week: String(week),
          day: `Day ${dayIndex + 1} — ${scheme.label}`,
          exerciseName: lift.exerciseName,
          sets: scheme.sets,
          reps: scheme.reps,
          weight: null,
          rpe: null,
          rest: null,
          timeSeconds: null,
        });
      }
    });
  }

  const weightDeltas = DUP_WEEKLY_SCHEME.map((s) => Math.round((s.percentOfTrainingMax - 1) * 1000) / 10);
  const repsPattern = DUP_WEEKLY_SCHEME.map((s) => s.repsTarget);

  const progressionRules: DupProgressionRule[] = lifts.map((lift) => ({
    exerciseName: lift.exerciseName,
    model: "wave_from_training_max",
    config: { weightDeltas, repsPattern, unit: "percent" },
    tierLabel: "DUP",
  }));

  return { rows, progressionRules };
}
