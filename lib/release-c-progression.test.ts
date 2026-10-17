import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { estimateTrainingMax, MAX_ESTIMATE_REPS } from "@/lib/training-max";
import { estimateOneRepMax } from "@/lib/one-rep-max";
import { estimateTrainingMaxFromSet } from "@/lib/rpe-training-max";
import { roundLoad, DEFAULT_STEP } from "@/lib/load-rounding";
import { asSetType, countsForProgress, SET_TYPES } from "@/lib/set-types";
import { resolveProgressionTarget, resolveGzclpT1Target } from "@/lib/progressions";

const src = (p: string) => readFileSync(join(__dirname, "..", p), "utf8").replace(/\r\n/g, "\n");

describe("one estimate of a training max", () => {
  it("Epley plus reps in reserve, a set with no RPE counting as RPE 9, the same arithmetic the database uses", () => {
    expect(estimateTrainingMax(225, 5, 8)).toBe(277.5); // 225 x (1 + 7/30)
    expect(estimateTrainingMax(225, 5)).toBe(270); // no RPE = RPE 9: 225 x (1 + 6/30)
    expect(estimateTrainingMax(225, 5, 10)).toBe(262.5);
  });
  it("trusts only sets of 1 to 8 reps", () => {
    expect(MAX_ESTIMATE_REPS).toBe(8);
    expect(estimateTrainingMax(135, 9)).toBeNull();
    expect(estimateTrainingMax(135, 8)).not.toBeNull();
    expect(estimateTrainingMax(0, 5)).toBeNull();
  });
  it("every other entry point is the same number", () => {
    expect(estimateOneRepMax(225, 5)).toBe(Math.round(estimateTrainingMax(225, 5)!));
    expect(estimateTrainingMaxFromSet(225, 5, 8)).toBe(estimateTrainingMax(225, 5, 8));
  });
  it("the database keeps the same limit (8 reps) and ignores warm-up and drop sets", () => {
    const sql = src("supabase/migrations/0385_set_types_and_records.sql");
    expect(sql).toContain("sl.reps between 1 and 8");
    expect(sql).toContain("new.reps > 8");
    expect(sql).toContain("sl.set_type in ('working', 'amrap', 'backoff')");
  });
});

describe("loads that can be loaded", () => {
  it("a percent rounds down to the plate step, an added amount to the nearest, never to zero", () => {
    expect(roundLoad(267.75, 5, "down")).toBe(265);
    expect(roundLoad(237.37, DEFAULT_STEP.lb, "nearest")).toBe(235);
    expect(roundLoad(2, 5, "down")).toBe(5);
    expect(roundLoad(60.4, 2.5, "nearest")).toBe(60);
  });
  it("a percent step in a progression lands on a loadable weight and a step up never rounds back to where it started", () => {
    const up = resolveProgressionTarget({
      model: "linear",
      config: { weightIncrement: 5, repIncrement: 0, unit: "percent" },
      occurrenceIndex: 2,
      referenceLog: { weight: 135, reps: 5 },
      previousOccurrenceLog: null,
    });
    expect(up.weight).toBe(140); // 141.75 rounds down to 140
    const tiny = resolveProgressionTarget({
      model: "linear",
      config: { weightIncrement: 2, repIncrement: 0, unit: "percent" },
      occurrenceIndex: 2,
      referenceLog: { weight: 20, reps: 5 },
      previousOccurrenceLog: null,
    });
    expect(tiny.weight).toBe(25); // 20.4 would round back to 20: one step up instead
  });
});

describe("set types", () => {
  it("warm-up and drop sets never count; anything unknown is a working set", () => {
    expect(SET_TYPES).toEqual(["warmup", "working", "amrap", "backoff", "drop"]);
    expect(countsForProgress("warmup")).toBe(false);
    expect(countsForProgress("drop")).toBe(false);
    expect(countsForProgress("working")).toBe(true);
    expect(countsForProgress("amrap")).toBe(true);
    expect(countsForProgress("backoff")).toBe(true);
    expect(asSetType("nonsense")).toBe("working");
    expect(asSetType(null)).toBe("working");
  });
  it("the progression loaders read the set type and skip uncounted sets", () => {
    const p = src("lib/progressions.ts");
    expect(p).toContain("weight, reps, set_type,");
    expect(p).toContain("reps, set_order, set_type,");
    expect(p).toContain("if (!countsForProgress(row.set_type)) continue;");
  });
});

describe("double progression looks at every counted set", () => {
  const cfg = { repRangeLow: 8, repRangeHigh: 12, weightIncrement: 5, unit: "lbs" as const };
  const target = (sets: { weight: number; reps: number }[]) =>
    resolveProgressionTarget({
      model: "double_progression",
      config: cfg,
      occurrenceIndex: 2,
      referenceLog: null,
      previousOccurrenceLog: { weight: sets[0].weight, reps: Math.max(...sets.map((s) => s.reps)), sets },
    });
  it("every set at the top of the range: up a step, back to the bottom of the range", () => {
    const t = target([{ weight: 135, reps: 12 }, { weight: 135, reps: 12 }, { weight: 135, reps: 12 }]);
    expect(t).toMatchObject({ weight: 140, reps: 8 });
    expect(t.reason).toBe("You hit 12 reps on every set at 135, so up to 140.");
  });
  it("one weak set holds the weight: the top set hitting 12 is not enough", () => {
    const t = target([{ weight: 135, reps: 12 }, { weight: 135, reps: 10 }, { weight: 135, reps: 9 }]);
    expect(t).toMatchObject({ weight: 135, reps: 10 });
    expect(t.reason).toContain("lowest set last time was 9 reps");
  });
});

describe("GZCLP T1 over twelve sessions", () => {
  const cfg = { startingWeight: 100, weightIncrement: 5, unit: "lbs" as const, deloadPercent: 10 };
  it("adds weight on a pass, drops a stage on a miss, resets only after failing the last stage, and says why", () => {
    // sessions 1-3 pass (100 -> 115), 4 misses 5x3+ (stage 2, 115), 5 misses 6x2+ (stage 3, 115), 6 misses 10x1+ (reset: 115 x 0.9 = 103.5 -> 100)
    const reps = [3, 3, 3, 2, 1, 0, 3, 3, 3, 3, 3];
    const history = reps.map((r, i) => ({ occurrenceIndex: i + 1, amrapReps: r }));
    expect(resolveGzclpT1Target({ config: cfg, occurrenceIndex: 4, history })).toMatchObject({ weight: 115, stage: 1 });
    expect(resolveGzclpT1Target({ config: cfg, occurrenceIndex: 5, history })).toMatchObject({ weight: 115, stage: 2, stageLabel: "6x2+" });
    expect(resolveGzclpT1Target({ config: cfg, occurrenceIndex: 6, history })).toMatchObject({ weight: 115, stage: 3 });
    const afterReset = resolveGzclpT1Target({ config: cfg, occurrenceIndex: 7, history });
    expect(afterReset).toMatchObject({ weight: 100, stage: 1 });
    expect(afterReset.reason).toContain("5x3+ at 100");
    expect(resolveGzclpT1Target({ config: cfg, occurrenceIndex: 12, history })).toMatchObject({ weight: 125, stage: 1 });
  });
});
