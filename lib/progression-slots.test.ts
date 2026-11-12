import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { getProgressionGoalsBatch, progressionKey } from "@/lib/progressions";

const root = join(__dirname, "..");
const src = (p: string) => readFileSync(join(root, p), "utf8").replace(/\r\n/g, "\n");

// A read-only fake: every query on a table resolves to that table's rows (the loader keys what it reads by name and day, so extra rows never mix in).
function fakeDb(tables: Record<string, unknown[]>) {
  return {
    from(table: string) {
      const chain: any = {
        select: () => chain,
        eq: () => chain,
        in: () => chain,
        order: () => chain,
        limit: () => chain,
        then: (resolve: any) => Promise.resolve({ data: tables[table] ?? [], error: null }).then(resolve),
      };
      return chain;
    },
  } as any;
}

const daysAgo = (n: number) => new Date(Date.now() - n * 86400000).toISOString();
const day = (id: string, week: number, dayIndex: number) => ({ id, week_number: week, day_index: dayIndex, program_id: "p" });
const row = (id: string, name: string, slot: string, workout: ReturnType<typeof day>) => ({ id, exercise_name: name, progression_slot: slot, workout_id: workout.id, workouts: workout });
const set = (name: string, workoutId: string, setOrder: number, weight: number, reps: number, at: string) => ({
  weight,
  reps,
  set_order: setOrder,
  set_type: "working",
  completed_at: at,
  session_exercises: { exercise_name: name, session_id: `s-${workoutId}`, athlete_sessions: { athlete_id: "a", workout_id: workoutId } },
});

describe("progression rules by the exercise's place in the program (GZCLP T1 and T2 of one lift)", () => {
  // Back Squat is T1 on Day 1 and T2 on Day 3, in weeks 1 and 2.
  const w1d1 = day("w1d1", 1, 1);
  const w1d3 = day("w1d3", 1, 3);
  const w2d1 = day("w2d1", 2, 1);
  const w2d3 = day("w2d3", 2, 3);
  const tables = {
    exercise_progressions: [
      { exercise_name: "Back Squat", slot: "T1", model: "gzclp_t1", config: { startingWeight: 225, weightIncrement: 5, unit: "lbs", deloadPercent: 10 } },
      { exercise_name: "Back Squat", slot: "T2", model: "double_progression", config: { repRangeLow: 10, repRangeHigh: 10, weightIncrement: 5, unit: "lbs" } },
    ],
    group_workout_exercises: [row("x1", "Back Squat", "T1", w1d1), row("x2", "Back Squat", "T2", w1d3), row("x3", "Back Squat", "T1", w2d1), row("x4", "Back Squat", "T2", w2d3)],
    set_logs: [
      // week 1 T1: 5 sets of 3 at 225, 5 reps on the last set (a pass)
      ...[0, 1, 2, 3].map((o) => set("Back Squat", "w1d1", o, 225, 3, daysAgo(3))),
      set("Back Squat", "w1d1", 4, 225, 5, daysAgo(3)),
      // week 1 T2: 3 sets of 10 at 115 (every set at the top)
      ...[0, 1, 2].map((o) => set("Back Squat", "w1d3", o, 115, 10, daysAgo(1))),
    ],
  };

  it("week 2's T1 day replays only the T1 days: 225 passed, so 230 for 3 (the T2 day's 10 reps are not read as a T1 pass)", async () => {
    const goals = await getProgressionGoalsBatch(fakeDb(tables), { programId: "p", athleteId: "a", currentWorkoutId: "w2d1", exercises: [{ slotId: "x3", exerciseName: "Back Squat" }] });
    expect(goals.get("x3")).toMatchObject({ weight: 230, reps: 3 });
  });

  it("week 2's T2 day follows its own T2 rule from the last T2 day: every set hit 10 at 115, so 120 for 10", async () => {
    const goals = await getProgressionGoalsBatch(fakeDb(tables), { programId: "p", athleteId: "a", currentWorkoutId: "w2d3", exercises: [{ slotId: "x4", exerciseName: "Back Squat" }] });
    expect(goals.get("x4")).toMatchObject({ weight: 120, reps: 10 });
  });

  it("week 1's T1 day starts at the T1 starting weight; week 1's T2 day has no goal yet (the coach's own number stands)", async () => {
    const t1 = await getProgressionGoalsBatch(fakeDb(tables), { programId: "p", athleteId: "a", currentWorkoutId: "w1d1", exercises: [{ slotId: "x1", exerciseName: "Back Squat" }] });
    expect(t1.get("x1")).toMatchObject({ weight: 225, reps: 3 });
    const t2 = await getProgressionGoalsBatch(fakeDb(tables), { programId: "p", athleteId: "a", currentWorkoutId: "w1d3", exercises: [{ slotId: "x2", exerciseName: "Back Squat" }] });
    expect(t2.has("x2")).toBe(false);
  });

  it("a program without slots works as before: the name's rule, every occurrence of the name", async () => {
    const b1 = day("b1", 1, 1);
    const b2 = day("b2", 2, 1);
    const plain = {
      exercise_progressions: [{ exercise_name: "Bench", slot: "", model: "double_progression", config: { repRangeLow: 8, repRangeHigh: 12, weightIncrement: 5, unit: "lbs" } }],
      group_workout_exercises: [row("y1", "Bench", "", b1), row("y2", "Bench", "", b2)],
      set_logs: [0, 1, 2].map((o) => set("Bench", "b1", o, 135, 12, daysAgo(2))),
    };
    const goals = await getProgressionGoalsBatch(fakeDb(plain), { programId: "p", athleteId: "a", currentWorkoutId: "b2", exercises: [{ slotId: "y2", exerciseName: "Bench" }] });
    expect(goals.get("y2")).toMatchObject({ weight: 140, reps: 8 });
  });

  it("a rule of another slot is never used: a T1 lift with only a T2 rule gets no goal", async () => {
    const onlyT2 = { ...tables, exercise_progressions: tables.exercise_progressions.filter((r) => r.slot === "T2") };
    const goals = await getProgressionGoalsBatch(fakeDb(onlyT2), { programId: "p", athleteId: "a", currentWorkoutId: "w2d1", exercises: [{ slotId: "x3", exerciseName: "Back Squat" }] });
    expect(goals.has("x3")).toBe(false);
  });

  it("keys never mix a name and a slot", () => {
    expect(progressionKey("Back Squat", "T1")).not.toBe(progressionKey("Back Squat", "T2"));
    expect(progressionKey("Back Squat", null)).toBe(progressionKey("Back Squat", ""));
  });
});

describe("the database step and every writer use the name-and-slot key", () => {
  const migration = src("supabase/migrations/0449_progression_slots.sql");
  const paste = src("supabase/apply/apply-step204-0449.sql");
  const undo = src("supabase/apply/undo-step204-0449.sql");
  it("the paste adds both columns with '' for every existing row, swaps the key, and makes Duplicate copy both", () => {
    expect(paste.split("\n")[0]).toMatch(/^-- PASTE: step 204 \(/);
    expect(paste).toContain("begin;");
    expect(paste).toContain("commit;");
    expect(paste).toContain(migration.trim());
    expect(migration).toContain("alter table public.exercise_progressions add column if not exists slot text not null default '';");
    expect(migration).toContain("alter table public.group_workout_exercises add column if not exists progression_slot text not null default '';");
    expect(migration).toContain("unique (program_id, exercise_name, slot)");
    expect(migration).toContain("e.is_slot, e.slot_side, e.slot_tier, e.progression_slot");
    expect(migration).toContain("model, config, tier_label, slot, v_by");
    expect(undo).toContain("unique (program_id, exercise_name)");
    expect(undo).toContain("drop column if exists progression_slot");
  });
  it("no upsert is left on the old one-rule-per-name key", () => {
    const files: string[] = [];
    const walk = (dir: string) => {
      for (const e of readdirSync(join(root, dir), { withFileTypes: true })) {
        const p = `${dir}/${e.name}`;
        if (e.isDirectory()) walk(p);
        else if (/\.(ts|tsx)$/.test(e.name) && !e.name.endsWith(".test.ts")) files.push(p);
      }
    };
    for (const d of ["lib", "components", "app"]) walk(d);
    for (const f of files) expect(src(f), f).not.toContain('onConflict: "program_id,exercise_name"');
    expect(src("components/coach/progression-row.tsx")).toContain('onConflict: "program_id,exercise_name,slot"');
  });
  it("the import saves the rule's slot and each exercise's slot; the builder reads it, and its copies and restores keep it", () => {
    const writer = src("lib/write-imported-program.ts");
    expect(writer).toContain("...(rule.slot ? { slot: rule.slot } : {})");
    expect(writer).toContain("...(ex.progressionSlot ? { progression_slot: ex.progressionSlot } : {})");
    expect(src("lib/workout-import-parser.ts")).toContain("...(row.progressionSlot ? { progressionSlot: row.progressionSlot } : {})");
    expect(src("lib/program-builder-data.ts").match(/progression_slot/g)?.length).toBe(4);
    expect(src("lib/program-restore.ts")).toContain("progression_slot: ex.progressionSlot");
    expect(src("components/coach/desktop/duplicate-week-panel.tsx")).toContain("progression_slot: first.progressionSlot");
    expect(src("lib/rename-program-exercise.ts")).toContain('.eq("slot", slot)');
    expect(src("app/(coach)/groups/[groupId]/programs/[programId]/progressions/page.tsx")).toContain("slot={slot}");
  });
});
