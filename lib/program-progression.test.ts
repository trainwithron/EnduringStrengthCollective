import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { BuilderDay } from "@/lib/types";
import { DEFAULT_DOUBLE, clearDouble, describeDouble, doubleConfig, exerciseNamesOf, readProgramProgression, saveDouble, setIdsOf, validateDouble, withRange } from "@/lib/program-progression";
import { resolveProgressionTarget } from "@/lib/progressions";

const src = (p: string) => readFileSync(join(__dirname, "..", p), "utf8").replace(/\r\n/g, "\n");

const set = (id: string) => ({ id, setOrder: 0, targetReps: null, targetWeight: null, targetRpe: null, targetRir: null, targetTempo: null, targetTimeSeconds: null, targetHeight: null, targetDistance: null, targetRestSeconds: null, targetPace: null, repMin: null, repMax: null });
const ex = (id: string, name: string, sets: string[], slot = false) => ({ kind: "exercise" as const, id, order: 0, exerciseName: name, displayName: null, movementPatternId: null, trackedFields: ["reps"], notes: null, videoPath: null, youtubeUrl: null, tier: null, sets: sets.map(set), slot: slot ? { side: null, tier: null } : null }) as any;
const days: BuilderDay[] = [
  { id: "d1", title: "Day 1", weekNumber: 1, dayIndex: 1, scheduledDate: null, items: [ex("e1", "Bench", ["s1", "s2"]), ex("e2", "Row", ["s3"]), ex("e3", "Slot", ["s9"], true), { kind: "note", id: "n1", order: 5, body: "hi" } as any] },
  { id: "d2", title: "Day 2", weekNumber: 1, dayIndex: 2, scheduledDate: null, items: [ex("e4", "Bench", ["s4"]), ex("e5", "Squat", ["s5"])] },
];

function fakeDb() {
  const calls: { table: string; op: string; payload?: unknown; opts?: unknown; filters: unknown[] }[] = [];
  const make = (table: string) => {
    const call: any = { table, op: "", filters: [] };
    calls.push(call);
    const chain: any = {
      upsert: (rows: unknown, opts: unknown) => ((call.op = "upsert"), (call.payload = rows), (call.opts = opts), Promise.resolve({ error: null })),
      update: (p: unknown) => ((call.op = "update"), (call.payload = p), chain),
      delete: () => ((call.op = "delete"), chain),
      eq: (...a: unknown[]) => (call.filters.push(["eq", ...a]), chain),
      in: (...a: unknown[]) => (call.filters.push(["in", ...a]), Promise.resolve({ error: null })),
    };
    return chain;
  };
  return { calls, db: { from: make } as any };
}

describe("program-wide double progression", () => {
  it("reads the real exercises once each, skipping template slots and notes", () => {
    expect(exerciseNamesOf(days)).toEqual(["Bench", "Row", "Squat"]);
    expect(setIdsOf(days)).toEqual(["s1", "s2", "s3", "s4", "s5"]);
  });
  it("checks the numbers and says what it will do in plain words", () => {
    expect(validateDouble(DEFAULT_DOUBLE)).toBeNull();
    expect(validateDouble({ low: 12, high: 8, increment: 5 })).toMatch(/higher/);
    expect(validateDouble({ low: 8, high: 12, increment: 0 })).toMatch(/more than 0/);
    expect(describeDouble(DEFAULT_DOUBLE)).toBe("Everyone starts at 8 reps. When they hit 12 reps on their heaviest set, the weight goes up 5 lb and reps go back to 8.");
  });
  it("one save writes the engine's own rows for every exercise and the rep range on every set", async () => {
    const { calls, db } = fakeDb();
    const err = await saveDouble(db, { programId: "p", groupId: "g", userId: "u", names: ["Bench", "Row", "Squat"], setIds: setIdsOf(days), settings: DEFAULT_DOUBLE });
    expect(err).toBeNull();
    const up = calls.find((c) => c.op === "upsert")!;
    expect(up.table).toBe("exercise_progressions");
    expect(up.opts).toEqual({ onConflict: "program_id,exercise_name" });
    expect((up.payload as any[]).map((r) => r.exercise_name)).toEqual(["Bench", "Row", "Squat"]);
    expect((up.payload as any[])[0]).toMatchObject({ program_id: "p", group_id: "g", model: "double_progression", created_by: "u", config: { repRangeLow: 8, repRangeHigh: 12, weightIncrement: 5, unit: "lbs" } });
    const upd = calls.find((c) => c.op === "update")!;
    expect(upd.table).toBe("group_workout_exercise_sets");
    expect(upd.payload).toEqual({ rep_min: 8, rep_max: 12 });
    expect(upd.filters[0]).toEqual(["in", "id", ["s1", "s2", "s3", "s4", "s5"]]);
  });
  it("a bad range writes nothing", async () => {
    const { calls, db } = fakeDb();
    expect(await saveDouble(db, { programId: "p", groupId: "g", userId: "u", names: ["Bench"], setIds: ["s1"], settings: { low: 12, high: 8, increment: 5 } })).toMatch(/higher/);
    expect(calls).toHaveLength(0);
  });
  it("turning it off removes only double-progression rules of this program's exercises", async () => {
    const { calls, db } = fakeDb();
    await clearDouble(db, { programId: "p", names: ["Bench"] });
    const del = calls.find((c) => c.op === "delete")!;
    expect(del.filters).toEqual([["eq", "program_id", "p"], ["eq", "model", "double_progression"], ["in", "exercise_name", ["Bench"]]]);
  });
  it("reads what the program's rules say as a whole", () => {
    const rule = (name: string, model = "double_progression", lo = 8) => ({ exercise_name: name, model, config: doubleConfig({ low: lo, high: 12, increment: 5 }) });
    expect(readProgramProgression(["Bench", "Row"], [])).toEqual({ kind: "none" });
    expect(readProgramProgression(["Bench", "Row"], [rule("Bench"), rule("Row")])).toEqual({ kind: "double", settings: DEFAULT_DOUBLE, covered: 2, total: 2 });
    expect(readProgramProgression(["Bench", "Row", "Squat"], [rule("Bench"), rule("Row")])).toMatchObject({ kind: "double", covered: 2, total: 3 });
    expect(readProgramProgression(["Bench", "Row"], [rule("Bench"), rule("Row", "double_progression", 6)])).toEqual({ kind: "mixed" });
    expect(readProgramProgression(["Bench"], [rule("Bench", "linear")])).toEqual({ kind: "mixed" });
  });
  it("the builder's own copy of the sets takes the saved range", () => {
    const out = withRange(days, 8, 12);
    expect(setIdsOf(out)).toEqual(setIdsOf(days));
    expect((out[0].items[0] as any).sets.every((s: any) => s.repMin === 8 && s.repMax === 12)).toBe(true);
    expect((out[0].items[2] as any).sets[0].repMin).toBeNull(); // the template slot is untouched
    expect((withRange(days, 6, 10, "Squat")[1].items[0] as any).sets[0].repMin).toBeNull();
  });
  it("is the rule the engine already reads: reps at the top add the weight and go back to the bottom", () => {
    const config = doubleConfig(DEFAULT_DOUBLE);
    const top = resolveProgressionTarget({ model: "double_progression", config, occurrenceIndex: 2, referenceLog: null, previousOccurrenceLog: { weight: 100, reps: 12 } });
    expect(top).toEqual({ weight: 105, reps: 8 });
    const mid = resolveProgressionTarget({ model: "double_progression", config, occurrenceIndex: 2, referenceLog: null, previousOccurrenceLog: { weight: 100, reps: 9 } });
    expect(mid).toEqual({ weight: 100, reps: 10 });
    // the first time there is nothing to compare
    expect(resolveProgressionTarget({ model: "double_progression", config, occurrenceIndex: 1, referenceLog: null, previousOccurrenceLog: null })).toEqual({ weight: null, reps: null });
  });
});

describe("the builder and the way back from Progression", () => {
  const builder = src("components/coach/desktop/program-builder-desktop.tsx");
  const page = src("app/(coach)/groups/[groupId]/programs/[programId]/page.tsx");
  const prog = src("app/(coach)/groups/[groupId]/programs/[programId]/progressions/page.tsx");
  it("the toolbar no longer sends the coach off the page; the choice is inside the builder", () => {
    expect(builder).not.toContain("Exercise Progressions");
    expect(builder).toContain("<ProgramProgressionPanel");
  });
  it("the program page is always the saved program, and coming back from the progressions page lands on the builder, not the read-only phone view", () => {
    expect(page).toContain('export const dynamic = "force-dynamic"');
    expect(prog).toContain('export const dynamic = "force-dynamic"');
    expect(prog).toContain("/programs/${params.programId}?edit=1");
    expect(builder).toContain("e.persisted");
    expect(builder).toContain("router.refresh()");
  });
  it("a failed read of the days is shown as a failure with Try again, never as an empty program", () => {
    expect(src("lib/program-builder-data.ts")).toContain("loadFailed: !!workoutsError");
    expect(page).toContain("data.loadFailed && <ProgramLoadRetry />");
    expect(page).toContain("!data.loadFailed && <ProgramBuilderDesktop");
  });
  it("closing the tab with something typed and not yet saved asks first; Saved clears it", () => {
    expect(builder).toContain('window.addEventListener("beforeunload"');
    expect(builder).toContain('event.kind === "saved"');
  });
  it("one exercise can differ in its Edit details, writing the same rows", () => {
    expect(src("components/coach/exercise-builder-card.tsx")).toContain("<ExerciseProgressionControl");
    expect(src("components/coach/exercise-progression-control.tsx")).toContain("saveDouble(");
  });
});
