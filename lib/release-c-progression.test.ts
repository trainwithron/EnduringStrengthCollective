import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { estimateTrainingMax, MAX_ESTIMATE_REPS } from "@/lib/training-max";
import { estimateOneRepMax } from "@/lib/one-rep-max";
import { estimateTrainingMaxFromSet } from "@/lib/rpe-training-max";
import { roundLoad, DEFAULT_STEP } from "@/lib/load-rounding";
import { asSetType, countsForProgress, SET_TYPES } from "@/lib/set-types";
import { resolveProgressionTarget, resolveGzclpT1Target } from "@/lib/progressions";
import { pickRecordSet } from "@/lib/record-set";
import { writeSetLogRow } from "@/lib/set-log-saver";

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
  it("the database makes new maxes only from 1 to 8 reps, never wipes or lowers a stored one by that change, and ignores warm-up and drop sets", () => {
    const sql = src("supabase/migrations/0385_set_types_and_records.sql");
    expect(sql).toContain("best_high as (");
    expect(sql).toContain("least(bh.estimate, m.estimated_max)");
    expect(sql).toContain("new.reps > 8");
    // no rebuild runs when the step is applied
    expect(sql).not.toContain("recompute_training_maxes(r.athlete_id");
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

describe("review fixes for Release C", () => {
  it("a hold has its own record field, so a hold and a timed distance for one exercise cannot collide", () => {
    const sql = src("supabase/migrations/0385_set_types_and_records.sql");
    expect(sql.split("'hold_seconds', 'higher_better'").length - 1).toBe(4); // three record checks and the rebuild of old hold records
    expect(sql).not.toContain("'time_seconds', 'higher_better'");
    // the old shortest-hold records are replaced by the real longest holds
    expect(sql).toContain("-- Hold records.");
    expect(sql).toContain("tracked_field = 'time_seconds'");
  });
  it("a stored max resting on a set of more than 12 reps is kept (the earlier rules had no rep limit)", () => {
    const sql = src("supabase/migrations/0385_set_types_and_records.sql");
    expect(sql).not.toContain("sl.reps between 1 and 12");
    expect(sql).toContain("and sl.reps >= 1");
  });
  it("the set-type trigger calls a rebuild with no caller check, which nobody signed in or out can call", () => {
    const sql = src("supabase/migrations/0385_set_types_and_records.sql");
    expect(sql).toContain("perform public.recompute_training_maxes_internal(v_athlete, v_exercise);");
    expect(sql).toContain("revoke all on function public.recompute_training_maxes_internal(uuid, text) from public, anon, authenticated;");
  });
  it("the share card names the set that earned the record, not just the heaviest set", () => {
    // 185 x 8 is the record (est 1RM 234); the 225 x 1 single was matched by an earlier 225 x 1
    const set = pickRecordSet([{ weight: 225, reps: 1 }, { weight: 185, reps: 8 }], [{ weight: 225, reps: 1 }, { weight: 185, reps: 6 }]);
    expect(set).toEqual({ weight: 185, reps: 8 });
    // with no earlier sets the strongest by estimated 1RM
    expect(pickRecordSet([{ weight: 225, reps: 1 }, { weight: 185, reps: 8 }], [])).toEqual({ weight: 185, reps: 8 });
    expect(pickRecordSet([{ weight: 100, reps: 5 }], [{ weight: 100, reps: 5 }])).toBeNull();
  });
  it("the share card shows the longest hold, counts only working sets, and the logger's unlock and prior best skip warm-ups", () => {
    const share = src("lib/shared-workout.ts");
    expect(share).toContain("holdSeconds");
    expect(share).toContain("if (!countsForProgress(row.set_type)) continue;");
    const grid = src("components/logging/exercise-set-grid.tsx");
    expect(grid).toContain('s.setType !== "warmup" && s.setType !== "drop"');
    const page = src("app/sessions/[sessionId]/page.tsx");
    expect(page).toContain("countedRowsByName");
    expect(page).toContain("readLoggedSets(");
  });
  it("a set checked off with no reps does not decide the next rep goal", () => {
    const goal = resolveProgressionTarget({
      model: "double_progression",
      config: { repRangeLow: 8, repRangeHigh: 12, weightIncrement: 5, unit: "lbs" } as any,
      occurrenceIndex: 2,
      referenceLog: null,
      previousOccurrenceLog: { weight: 135, reps: 12, sets: [{ weight: 135, reps: 12 }, { weight: 135, reps: 12 }, { weight: 135, reps: 0 }] } as any,
    });
    expect(goal.weight).toBe(140);
  });
  it("GZCLP T1 judges the set marked as many as possible, and a back-off set after it is never the one judged", () => {
    const p = src("lib/progressions.ts");
    expect(p).toContain("amrapMarked");
    expect(p).toContain('row.set_type === "backoff"');
  });
  it("a merged save that fails only on the missing set-type column still stores the logged values", async () => {
    const calls: Record<string, unknown>[] = [];
    const client: any = {
      from: () => ({
        update: (v: Record<string, unknown>) => {
          calls.push(v);
          return {
            eq: () => ({
              select: async () =>
                "set_type" in v
                  ? { data: null, error: { message: 'column "set_type" of relation "set_logs" does not exist' } }
                  : { data: [{ id: "x" }], error: null },
            }),
          };
        },
      }),
    };
    expect(await writeSetLogRow(client, "x", { weight: 135, reps: 5, set_type: "warmup" })).toBe(true);
    expect(calls).toEqual([{ weight: 135, reps: 5, set_type: "warmup" }, { weight: 135, reps: 5 }]);
    expect(await writeSetLogRow(client, "x", { set_type: "warmup" })).toBe(true);
  });
  it("the undo warns that the Release C code must not be live, and removes the new hold records and the internal rebuild", () => {
    const build = src("scripts/build-paste-files.mjs");
    expect(build).toContain("Run it ONLY while the Release C code is not live");
    expect(build).toContain("delete from public.exercise_records where tracked_field = 'hold_seconds';");
    expect(build).toContain("drop function if exists public.recompute_training_maxes_internal(uuid, text);");
  });
});
