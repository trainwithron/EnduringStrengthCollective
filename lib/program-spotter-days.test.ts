import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { SupabaseClient } from "@supabase/supabase-js";
import { detectTooManyLiftingDays, LIFTING_DAY_CATEGORIES, type ProgramDayEntry } from "@/lib/programming-spotter";
import { gatherProgrammingSpotterFlags } from "@/lib/programming-spotter-gather";
import { cornerstoneForSpotterKind } from "@/lib/spotter-expert-report";

// Ron, Nov 24: the program Spotter flags more lifting days than the client said they can train, never the optional at-home mobility / core days ("So I don't want to be
// getting spammed").
const read = (p: string) => readFileSync(join(__dirname, "..", p), "utf8").replace(/\r\n/g, "\n");

// One week of days: each day is a list of categories (one per exercise).
const week = (weekNumber: number, days: (string | null)[][]): ProgramDayEntry[] =>
  days.flatMap((cats, d) => cats.map((category) => ({ workoutId: `w${weekNumber}d${d + 1}`, weekNumber, category: category as ProgramDayEntry["category"] })));

describe("the check (pure)", () => {
  it("Ron's exact case: 3 lifting days plus 2 mobility / core days, a sheet of 3: NOT flagged", () => {
    const entries = week(1, [["Full Body", "Legs", "Core"], ["Mobility", "Core"], ["Push", "Pull"], ["Mobility", "Cardio"], ["Legs", "Pull", "Core"]]);
    expect(detectTooManyLiftingDays(entries, 3)).toBeNull();
  });
  it("4 lifting days with a sheet of 3: flagged once, for the busiest week", () => {
    const entries = [
      ...week(1, [["Push"], ["Pull"], ["Legs"]]),
      ...week(2, [["Push"], ["Pull"], ["Legs"], ["Full Body"]]),
      ...week(3, [["Push"], ["Pull"], ["Legs"], ["Full Body"]]),
    ];
    expect(detectTooManyLiftingDays(entries, 3)).toEqual({ weekNumber: 2, liftingDays: 4, daysPerWeek: 3 });
  });
  it("under is fine: 2 lifting days with a sheet of 3", () => {
    expect(detectTooManyLiftingDays(week(1, [["Push", "Pull"], ["Legs"]]), 3)).toBeNull();
  });
  it("no sheet (or no number on it): never flagged", () => {
    const entries = week(1, [["Push"], ["Pull"], ["Legs"], ["Full Body"], ["Push"]]);
    expect(detectTooManyLiftingDays(entries, null)).toBeNull();
    expect(detectTooManyLiftingDays(entries, undefined)).toBeNull();
    expect(detectTooManyLiftingDays(entries, 0)).toBeNull();
  });
  it("only Push, Pull, Legs and Full Body make a lifting day; an exercise with no category does not", () => {
    expect([...LIFTING_DAY_CATEGORIES].sort()).toEqual(["Full Body", "Legs", "Pull", "Push"]);
    expect(detectTooManyLiftingDays(week(1, [["Push"], [null], [null, "Core"], ["Cardio"]]), 1)).toBeNull();
  });
});

// ---- the gather, on an in-memory stand-in ----
type Row = Record<string, any>;
function fakeDb(tables: Record<string, Row[]>): SupabaseClient {
  const from = (table: string) => {
    const filters: ((r: Row) => boolean)[] = [];
    let limit = Infinity;
    const run = () => ({ data: (tables[table] ?? []).filter((r) => filters.every((f) => f(r))).slice(0, limit), error: null });
    const b: any = {
      select: () => b,
      eq: (k: string, v: unknown) => (filters.push((r) => k.includes(".") || r[k] === v), b),
      in: (k: string, v: unknown[]) => (filters.push((r) => k.includes(".") || v.includes(r[k])), b),
      order: () => b,
      limit: (n: number) => ((limit = n), b),
      maybeSingle: async () => ({ data: run().data[0] ?? null, error: null }),
      then: (res: (v: any) => void, rej: (e: any) => void) => Promise.resolve(run()).then(res, rej),
    };
    return b;
  };
  return { from } as unknown as SupabaseClient;
}
const COACH = "coach-1";
const library = ["Back Squat:Legs", "Bench Press:Push", "Barbell Row:Pull", "Deadlift:Full Body", "Hip Mobility Flow:Mobility", "Dead Bug:Core", "Bike:Cardio"].map((s) => {
  const [name, category] = s.split(":");
  return { name, category, created_by: COACH };
});
function programTables(days: string[][], opts: { athlete?: string | null; sheetDays?: number | null; dismissed?: Row[] } = {}): Record<string, Row[]> {
  const workouts = days.map((_, i) => ({ id: `w${i + 1}`, week_number: 1, program_id: "prog-1" }));
  const exercises = days.flatMap((names, i) => names.map((exercise_name, j) => ({ id: `e${i}-${j}`, workout_id: `w${i + 1}`, exercise_name, exercise_order: j, group_workout_exercise_sets: [{ set_order: 1, target_reps: "5" }] })));
  return {
    workouts,
    group_workout_exercises: exercises,
    exercise_library: library,
    programs: [{ id: "prog-1", athlete_id: opts.athlete === undefined ? "robyn" : opts.athlete, group_id: "g1" }],
    client_goal_sheets: opts.sheetDays === undefined ? [{ athlete_id: "robyn", group_id: "g1", days_per_week: 3 }] : opts.sheetDays === null ? [] : [{ athlete_id: "robyn", group_id: "g1", days_per_week: opts.sheetDays }],
    profiles: [{ id: "robyn", full_name: "Robyn Smith" }],
    programming_spotter_dismissals: opts.dismissed ?? [],
  };
}
const RON_WEEK = [["Deadlift", "Back Squat", "Dead Bug"], ["Hip Mobility Flow", "Dead Bug"], ["Bench Press", "Barbell Row"], ["Hip Mobility Flow", "Bike"], ["Back Squat", "Barbell Row"]];
const FOUR_LIFTING = [["Deadlift"], ["Bench Press"], ["Back Squat"], ["Barbell Row"], ["Hip Mobility Flow"]];
const lifting = async (tables: Record<string, Row[]>) =>
  (await gatherProgrammingSpotterFlags(fakeDb(tables), { programId: "prog-1", programName: "Robyn", coachId: COACH })).filter((f) => f.checkKind === "lifting_days");

describe("the check on a real program (gather)", () => {
  it("Ron's case is not flagged", async () => {
    expect(await lifting(programTables(RON_WEEK))).toEqual([]);
  });
  it("4 lifting days with a sheet of 3: one flag, in the coach's words, keyed by the sheet's number", async () => {
    const flags = await lifting(programTables(FOUR_LIFTING));
    expect(flags).toHaveLength(1);
    expect(flags[0]).toMatchObject({ patternKey: "sheet_3", promptStopSuggesting: false });
    expect(flags[0].headline).toBe("Week 1 has 4 lifting days, and Robyn's goal sheet says 3 a week is realistic. Keep it, or trim to 3?");
  });
  it("no sheet, or a program for no one client: never flagged", async () => {
    expect(await lifting(programTables(FOUR_LIFTING, { sheetDays: null }))).toEqual([]);
    expect(await lifting(programTables(FOUR_LIFTING, { athlete: null }))).toEqual([]);
  });
  it("said no to twice (the existing dismissal memory): not shown again; a changed sheet gets a fresh look", async () => {
    const dismissed = [{ program_id: "prog-1", check_kind: "lifting_days", pattern_key: "sheet_3", dismissed_count: 2 }];
    expect(await lifting(programTables(FOUR_LIFTING, { dismissed }))).toEqual([]);
    expect(await lifting(programTables(FOUR_LIFTING, { dismissed, sheetDays: 2 }))).toHaveLength(1);
  });
});

describe("only in the program Spotter panel: no push, no bell, coach-only", () => {
  it("the Tier-1 sync carries only kinds with a cornerstone, and this one has none", () => {
    expect(cornerstoneForSpotterKind("lifting_days")).toBeNull();
    expect(cornerstoneForSpotterKind("biomech_redundancy")).not.toBeNull();
    expect(read("lib/spotter-tier1-sync.ts")).toContain("if (!cornerstone) return;");
  });
  it("the check sends nothing anywhere", () => {
    const gather = read("lib/programming-spotter-gather.ts");
    expect(gather).not.toMatch(/notifications|sendPush|sendCoachPush|notifyPush/);
  });
  it("its answers are remembered like every other check's (step 228 allows it in the dismissals)", () => {
    expect(read("supabase/migrations/0472_program_spotter_lifting_days.sql")).toContain("'biomech_redundancy', 'lifting_days'");
    expect(read("scripts/sql-tests/harness.mjs")).toMatch(/"0470", ("0471", )?"0472"/);
  });
});
