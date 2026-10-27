import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { ALREADY_HAS_DAYS, FILL_FAILED, isAutomaticProgramName, writeImportedProgram, type WriteImportInput } from "./write-imported-program";
import type { ImportedWeek } from "./workout-import-parser";

// Ron, Oct 27: "whenever you import a program, it should only import one, so there's not an empty one left behind". Build program makes the empty program first; an import from its builder
// used to make a second program beside it (live: two empty "Sawyer's program" and a "New program").
type Row = Record<string, unknown>;
function makeDb(seed: { programs: Row[]; workouts?: Row[] }, failSetsOnCall: number | null = null) {
  const t: Record<string, Row[]> = { programs: seed.programs.map((r) => ({ ...r })), workouts: (seed.workouts ?? []).map((r) => ({ ...r })), group_workout_exercises: [], group_workout_exercise_sets: [], exercise_progressions: [] };
  let seq = 0;
  let setsCalls = 0;
  const from = (name: string) => {
    let mode: "select" | "insert" | "update" | "delete" = "select";
    let payload: Row | Row[] | null = null;
    let head = false;
    const filters: ((r: Row) => boolean)[] = [];
    let inserted: Row[] = [];
    let failed = false;
    const matching = () => (t[name] ??= []).filter((r) => filters.every((f) => f(r)));
    const run = () => {
      if (mode === "insert") {
        if (name === "group_workout_exercise_sets" && failSetsOnCall !== null && ++setsCalls === failSetsOnCall) {
          failed = true;
          return { data: null, error: { message: "network" } };
        }
        const rows = (Array.isArray(payload) ? payload : [payload]) as Row[];
        inserted = rows.map((r) => ({ id: `${name}-${++seq}`, ...r }));
        t[name].push(...inserted);
        return { data: inserted, error: null };
      }
      if (mode === "update") {
        const rows = matching();
        for (const r of rows) Object.assign(r, payload);
        return { data: rows, error: null };
      }
      if (mode === "delete") {
        const gone = new Set(matching().map((r) => r.id));
        t[name] = t[name].filter((r) => !gone.has(r.id));
        // on delete cascade: a day's exercises, and their sets
        if (name === "workouts") {
          const ex = new Set(t.group_workout_exercises.filter((e) => gone.has(e.workout_id)).map((e) => e.id));
          t.group_workout_exercises = t.group_workout_exercises.filter((e) => !ex.has(e.id));
          t.group_workout_exercise_sets = t.group_workout_exercise_sets.filter((s) => !ex.has(s.group_workout_exercise_id));
        }
        return { data: null, error: null };
      }
      // a read hands back copies, as the database does
      const rows = matching().map((r) => ({ ...r }));
      return { data: head ? null : rows, error: null, count: rows.length };
    };
    const b: Record<string, unknown> = {};
    Object.assign(b, {
      select: (_c?: string, o?: { head?: boolean }) => ((head = !!o?.head), b),
      insert: (v: Row | Row[]) => ((mode = "insert"), (payload = v), b),
      update: (v: Row) => ((mode = "update"), (payload = v), b),
      delete: () => ((mode = "delete"), b),
      eq: (c: string, v: unknown) => (filters.push((r) => r[c] === v), b),
      in: (c: string, v: unknown[]) => (filters.push((r) => v.includes(r[c])), b),
      single: async () => {
        const r = run();
        return { data: failed ? null : Array.isArray(r.data) ? (r.data[0] ?? null) : r.data, error: r.error };
      },
      maybeSingle: async () => {
        const r = run();
        return { data: Array.isArray(r.data) ? (r.data[0] ?? null) : r.data, error: r.error };
      },
      then: (res: (v: unknown) => unknown, rej?: (e: unknown) => unknown) => Promise.resolve(run()).then(res, rej),
    });
    return b;
  };
  return { db: { from } as never, t };
}

const weeks: ImportedWeek[] = [
  {
    weekLabel: "Week 1",
    weekNumber: 1,
    days: [
      { dayLabel: "Day 1", exercises: [{ exerciseName: "Back Squat", sets: 3, reps: "5", weight: null, rpe: null, timeSeconds: null } as never, { exerciseName: "Bench Press", sets: 3, reps: "8", weight: null, rpe: null, timeSeconds: null } as never] },
      { dayLabel: "Day 2", exercises: [{ exerciseName: "Deadlift", sets: 1, reps: "5", weight: null, rpe: null, timeSeconds: null } as never] },
    ],
  } as never,
];
const resolutions = new Map(["back squat", "bench press", "deadlift"].map((k) => [k, { exerciseName: k.replace(/\b\w/g, (c) => c.toUpperCase()), trackedFields: [] }]));
const input = (over: Partial<WriteImportInput> = {}): WriteImportInput => ({
  groupId: "g-sawyer",
  coachId: "ron",
  athleteId: "sawyer",
  orgProgram: false,
  programName: "Big Sauce",
  description: null,
  isAiSourced: false,
  startDate: "2026-10-27",
  trainingDays: [1, 3],
  sequencingNotes: null,
  weeks,
  resolutions,
  ...over,
});
// "Build program" for Sawyer: made at once, switched on, no days.
const opened = (name = "Sawyer's program", extra: Row = {}) => ({ id: "p-open", group_id: "g-sawyer", athlete_id: "sawyer", created_by: "ron", name, is_active: true, importing: false, ai_draft: false, description: null, start_date: null, training_days: null, visibility_window: null, ai_sequencing_notes: null, training_intent: null, org_program: false, ...extra });

describe("an import started in a program the coach opened", () => {
  it("fills that program when it has no days: one program, the same id, the automatic name replaced, switched on at the end", async () => {
    const { db, t } = makeDb({ programs: [opened()] });
    const r = await writeImportedProgram(db, input({ openProgram: { id: "p-open", automaticName: true } }));
    expect(r).toMatchObject({ programId: "p-open", filled: true, failedWrites: 0, finished: true });
    expect(t.programs).toHaveLength(1);
    expect(t.programs[0]).toMatchObject({ id: "p-open", name: "Big Sauce", athlete_id: "sawyer", group_id: "g-sawyer", importing: false, is_active: true, start_date: "2026-10-27", training_days: [1, 3] });
    expect(t.workouts.map((w) => [w.program_id, w.title])).toEqual([["p-open", "Day 1"], ["p-open", "Day 2"]]);
    expect(t.group_workout_exercises).toHaveLength(3);
    expect(t.group_workout_exercise_sets).toHaveLength(7);
  });

  it("a name the coach typed stays", async () => {
    const { db, t } = makeDb({ programs: [opened("Sawyer off-season")] });
    await writeImportedProgram(db, input({ openProgram: { id: "p-open", automaticName: false } }));
    expect(t.programs).toHaveLength(1);
    expect(t.programs[0].name).toBe("Sawyer off-season");
  });

  it("an organization's New program stays the organization's (no client, org_program kept)", async () => {
    const { db, t } = makeDb({ programs: [opened("New program", { athlete_id: null, org_program: true, is_active: false })] });
    await writeImportedProgram(db, input({ athleteId: null, orgProgram: true, openProgram: { id: "p-open", automaticName: true } }));
    expect(t.programs).toHaveLength(1);
    expect(t.programs[0]).toMatchObject({ id: "p-open", name: "Big Sauce", athlete_id: null, org_program: true });
  });

  it("a program that already has days is never mixed into: a new program is made, and the coach is told", async () => {
    const { db, t } = makeDb({ programs: [opened("Sawyer's program")], workouts: [{ id: "w-old", program_id: "p-open", title: "Old day" }] });
    const r = await writeImportedProgram(db, input({ openProgram: { id: "p-open", automaticName: true } }));
    expect(r).toMatchObject({ filled: false });
    expect("notices" in r && r.notices).toContain(ALREADY_HAS_DAYS);
    expect(ALREADY_HAS_DAYS).toBe("This program already has days, so the import is made as a new program.");
    expect(t.programs).toHaveLength(2);
    expect(t.programs[0]).toMatchObject({ id: "p-open", name: "Sawyer's program", is_active: true });
    expect(t.workouts.filter((w) => w.program_id === "p-open").map((w) => w.id)).toEqual(["w-old"]);
  });

  it("a failed import takes back only what it wrote and leaves the opened program as it was", async () => {
    const { db, t } = makeDb({ programs: [opened()] }, 2);
    const r = await writeImportedProgram(db, input({ openProgram: { id: "p-open", automaticName: true } }));
    expect(r).toEqual({ error: FILL_FAILED });
    expect(t.programs).toHaveLength(1);
    expect(t.programs[0]).toEqual(opened());
    expect(t.workouts).toHaveLength(0);
    expect(t.group_workout_exercises).toHaveLength(0);
    expect(t.group_workout_exercise_sets).toHaveLength(0);
  });

  it("with no program opened, a new program as before (and a half-written new program is kept with its notice, as before)", async () => {
    const { db, t } = makeDb({ programs: [] });
    const r = await writeImportedProgram(db, input({ athleteId: null }));
    expect(r).toMatchObject({ filled: false, failedWrites: 0 });
    expect(t.programs).toHaveLength(1);
    expect(t.programs[0]).toMatchObject({ name: "Big Sauce", group_id: "g-sawyer", created_by: "ron", athlete_id: null, importing: false, is_active: true });
    const half = makeDb({ programs: [] }, 1);
    const h = await writeImportedProgram(half.db, input());
    expect(h).toMatchObject({ failedWrites: 1 });
    expect(half.t.programs).toHaveLength(1);
  });
});

describe("the automatic name", () => {
  it("is New program, or [first name]'s program for that client; anything else was typed", () => {
    expect(isAutomaticProgramName("New program", null)).toBe(true);
    expect(isAutomaticProgramName("Sawyer's program", "Sawyer Steele")).toBe(true);
    expect(isAutomaticProgramName("Client's program", null)).toBe(true);
    expect(isAutomaticProgramName("Sawyer's program", "Maria Guerrero")).toBe(false);
    expect(isAutomaticProgramName("Big Sauce", "Sawyer Steele")).toBe(false);
  });
});

describe("where it is wired", () => {
  const read = (p: string) => readFileSync(join(__dirname, "..", p), "utf8").replace(/\r\n/g, "\n");
  it("the builder hands its program to both ways of importing (a file, and pasted text); the panel says when a new program will be made", () => {
    const box = read("components/coach/desktop/ai-program-builder-box.tsx");
    expect(box).toContain("<ProgramImportLauncher groupId={groupId} athleteId={athleteId} orgProgram={orgProgram} programId={programId} />");
    expect(box).toContain("<ProgramImportPanel groupId={groupId} athleteId={athleteId} orgProgram={orgProgram} programId={programId} text={importText}");
    const panel = read("components/coach/desktop/program-import-launcher.tsx");
    expect(panel).toContain("{ALREADY_HAS_DAYS}");
    expect(panel).toContain("openProgram={loaded.openProgram}");
    expect(read("components/coach/desktop/import-wizard.tsx")).toContain("openProgram: openProgram ?? null,");
  });
});
