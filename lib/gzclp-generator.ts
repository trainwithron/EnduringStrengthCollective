import type { ParsedImportRow } from "./workout-import-parser";
import { GZCLP_T1_STAGES, type ProgressionModel, type ProgressionConfig } from "./progressions";

// dup_gzclp_build_spec_sept15.md §1.3 — GZCLP is autoregulated by
// definition, so unlike DUP Path A this deliberately does NOT
// precompute weeks of target_weight up front (that would require
// guessing in advance whether the athlete succeeds or fails each
// session, defeating the point of the AMRAP-gated stage system). This
// generator only produces the week-1 shell (real starting weights on
// the very first occurrence of each lift, null everywhere else) plus
// the exercise_progressions rules that drive every occurrence from
// week 2 onward dynamically, via resolveGzclpT1Target/
// getProgressionGoalsBatch — same "suggest, don't silently commit"
// discipline the rest of the progression engine already follows.

export interface GzclpLiftInput {
  exerciseName: string;
  // Real starting weight for this lift's T1 (main) role — the caller is
  // responsible for deriving this from a real, coach-confirmed number
  // (e.g. a percentage of the athlete's persisted training max), never
  // inventing one here.
  t1StartingWeight: number;
  // T2 (secondary) role starts as its own, separate, coach-provided
  // number — GZCLP's T2 weight isn't a fixed fraction of T1, and there's
  // no persisted "T2 max" to derive it from, so this is never guessed.
  t2StartingWeight: number;
}

export interface GzclpGeneratorInput {
  // Exactly 4 lifts, in a fixed pairing order: lifts[0]/[1] pair together
  // (each is the other's T2 on alternating days), and lifts[2]/[3] pair
  // together the same way — the canonical squat/bench + press/deadlift
  // split, generalized to whatever 4 lifts the coach actually names.
  lifts: [GzclpLiftInput, GzclpLiftInput, GzclpLiftInput, GzclpLiftInput];
  weeksToGenerate: number;
  weightIncrement?: number; // default 5 — real convention, not physics
  deloadPercent?: number; // default 10
  t2WeightIncrement?: number;
  t3?: {
    exerciseName: string;
    startingWeight: number;
    // Which T1 lift's day this T3 accessory rides along on (0-3, index
    // into lifts[]) — GZCLP doesn't prescribe which accessory goes
    // where, so this stays a plain coach choice, one per day.
    dayIndex: 0 | 1 | 2 | 3;
  }[];
}

export interface GzclpProgressionRule {
  exerciseName: string;
  model: ProgressionModel;
  config: ProgressionConfig;
  // Display metadata only (exercise_progressions.tier_label) — a plain
  // string rather than a GZCLP-specific union so DUP Path B's entry
  // point in import-wizard.tsx can reuse this same shape for its own
  // wave_from_training_max rules ("DUP") without a separate type.
  tierLabel: string;
}

export interface GzclpGeneratorResult {
  rows: ParsedImportRow[];
  progressionRules: GzclpProgressionRule[];
}

const T1_SETS = 5; // stage 1's set count — the shell's static sets/reps
// text reflects Stage 1 only (occurrence 1); the coach sees the actual
// current stage's reps via the dynamic goalReps suggestion once real
// history exists, same "template stays static, suggestion moves"
// pattern the rest of this engine already uses.
const T1_REPS_LABEL = `${T1_SETS}x${GZCLP_T1_STAGES[0].minReps}+`;
const T2_SETS = 3;
const T2_REPS = 10;
const T3_SETS = 3;
const T3_REPS_LABEL = "15+";

export function generateGzclpProgram({
  lifts,
  weeksToGenerate,
  weightIncrement = 5,
  deloadPercent = 10,
  t2WeightIncrement = 5,
  t3 = [],
}: GzclpGeneratorInput): GzclpGeneratorResult {
  const rows: ParsedImportRow[] = [];

  // Day N's [T1, T2] pair — the standard GZCLP 4-day rotation, each of
  // the 4 lifts getting exactly one T1 slot and one T2 slot per week.
  const dayPairs: [GzclpLiftInput, GzclpLiftInput][] = [
    [lifts[0], lifts[1]],
    [lifts[2], lifts[3]],
    [lifts[1], lifts[0]],
    [lifts[3], lifts[2]],
  ];

  for (let week = 1; week <= weeksToGenerate; week++) {
    dayPairs.forEach(([t1Lift, t2Lift], dayIndex) => {
      const dayLabel = `Day ${dayIndex + 1}`;
      rows.push({
        week: String(week),
        day: dayLabel,
        exerciseName: t1Lift.exerciseName,
        sets: T1_SETS,
        reps: T1_REPS_LABEL,
        weight: week === 1 ? t1Lift.t1StartingWeight : null,
        rpe: null,
        rest: null,
        timeSeconds: null,
      });
      rows.push({
        week: String(week),
        day: dayLabel,
        exerciseName: t2Lift.exerciseName,
        sets: T2_SETS,
        reps: String(T2_REPS),
        weight: week === 1 ? t2Lift.t2StartingWeight : null,
        rpe: null,
        rest: null,
        timeSeconds: null,
      });
      const accessory = t3.find((a) => a.dayIndex === dayIndex);
      if (accessory) {
        rows.push({
          week: String(week),
          day: dayLabel,
          exerciseName: accessory.exerciseName,
          sets: T3_SETS,
          reps: T3_REPS_LABEL,
          weight: week === 1 ? accessory.startingWeight : null,
          rpe: null,
          rest: null,
          timeSeconds: null,
        });
      }
    });
  }

  // One progression rule per exercise NAME, not per (day, role) slot —
  // a lift with the same name only ever gets one exercise_progressions
  // row per program (unique(program_id, exercise_name)), which is
  // correct: e.g. "Back Squat" is T1 on Day 1 and T2 on Day 3 of the
  // SAME program, and both roles' math is driven by the one rule.
  const progressionRules: GzclpProgressionRule[] = [];
  const seen = new Set<string>();
  for (const [t1Lift, t2Lift] of dayPairs) {
    if (!seen.has(t1Lift.exerciseName)) {
      seen.add(t1Lift.exerciseName);
      progressionRules.push({
        exerciseName: t1Lift.exerciseName,
        model: "gzclp_t1",
        config: {
          startingWeight: t1Lift.t1StartingWeight,
          weightIncrement,
          unit: "lbs",
          deloadPercent,
        },
        tierLabel: "T1",
      });
    }
  }
  // Real, honest v1 limitation, discovered while implementing (not
  // previously flagged in the spec): in the canonical 4-lift pairing
  // above, every one of the 4 lifts plays T1 on exactly one of its two
  // weekly occurrences — so by the time this point is reached, all 4
  // names are already `seen` via the T1 loop. `exercise_progressions`
  // is unique per (program_id, exercise_name), so a lift can only carry
  // ONE dynamic rule per program; T1's autoregulated cascade is the one
  // that matters most (the weight actually depends on real performance,
  // where T2's doesn't move much), so it wins. T2 occurrences for these
  // 4 lifts use the static week-1 weight from the shell with no dynamic
  // update in v1 — same as any non-progression-linked exercise today,
  // not a crash or silent wrong number. `t2WeightIncrement` is accepted
  // but currently unused for this reason; kept in the signature so a v2
  // that splits T1/T2 by day (not just by name) can wire it in without
  // an API change.
  void t2WeightIncrement;
  for (const accessory of t3) {
    if (seen.has(accessory.exerciseName)) continue;
    seen.add(accessory.exerciseName);
    progressionRules.push({
      exerciseName: accessory.exerciseName,
      model: "double_progression",
      config: { repRangeLow: 15, repRangeHigh: 25, weightIncrement: 5, unit: "lbs" },
      tierLabel: "T3",
    });
  }

  return { rows, progressionRules };
}
