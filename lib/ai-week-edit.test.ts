import { describe, it, expect, vi } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  WHICH_WEEKS_QUESTION,
  applyWeekEdits,
  chargedPreview,
  checkPlanAgainstProgram,
  findExercise,
  isEditRequest,
  isYes,
  parseWeekRange,
  planWeekEdits,
  previewLines,
  readAiChanges,
  readPlan,
  resolveWeeks,
  type EditDb,
  type PlanDay,
  type SnapshotExercise,
} from "./ai-week-edit";

// Ron, Oct 26: "tell the workout builder on week one, the workout was a little short, so I want to add XYZ and then the reps were too high on these two exercises, so drop them down to 8.
// Going forwards, from week 2 on out."
const RON = "On week one the workout was a little short, so add farmer carries at the end, and the reps were too high on goblet squats and rows, so drop them down to 8. Going forwards, from week 2 on out.";
const read = (p: string) => readFileSync(join(__dirname, "..", p), "utf8").replace(/\r\n/g, "\n");

let n = 0;
const id = () => `00000000-0000-4000-8000-${String(++n).padStart(12, "0")}`;
function day(week: number, dayNo: number, names: string[], started = false): PlanDay {
  return {
    workoutId: id(),
    week,
    day: dayNo,
    started,
    exercises: names.map((name, i) => ({ id: id(), name, order: i, sets: [0, 1, 2].map((s) => ({ id: id(), setOrder: s, reps: "10", weight: null, rpe: 7 })) })),
  };
}
const program = () => [1, 2, 3, 4].flatMap((w) => [day(w, 1, ["Goblet Squat", "Seated Cable Row", "Plank"], w === 1), day(w, 2, ["Romanian Deadlift", "Push Up"], w === 1)]);
const ronChanges = readAiChanges({
  changes: [
    { op: "add", days: "all", exercise: "Farmer Carry", sets: 3, reps: "40 yd", position: "end" },
    { op: "change", days: "all", exercise: "goblet squats", reps: "8" },
    { op: "change", days: "all", exercise: "rows", reps: "8" },
  ],
}).changes;

describe("which weeks: read from the coach's words, asked when not said", () => {
  it("from week 2 on, weeks 3-6, rest of the program, every week", () => {
    expect(parseWeekRange(RON)).toEqual({ kind: "weeks", from: 2, to: null });
    expect(parseWeekRange("drop rows to 8 from week 2 on")).toEqual({ kind: "weeks", from: 2, to: null });
    expect(parseWeekRange("week three onward")).toEqual({ kind: "weeks", from: 3, to: null });
    expect(parseWeekRange("weeks 3-6")).toEqual({ kind: "weeks", from: 3, to: 6 });
    expect(parseWeekRange("weeks 3 to 6")).toEqual({ kind: "weeks", from: 3, to: 6 });
    expect(parseWeekRange("for the rest of the program")).toEqual({ kind: "rest" });
    expect(parseWeekRange("every week")).toEqual({ kind: "all" });
    expect(parseWeekRange("change week 3: swap rows for pull ups")).toEqual({ kind: "weeks", from: 3, to: 3 });
  });
  it("no weeks said: none (the box asks the one question); a week named as the past is not a range", () => {
    expect(parseWeekRange("drop the goblet squats to 8 reps")).toBeNull();
    expect(parseWeekRange("on week one the workout was a little short, add farmer carries")).toBeNull();
    expect(WHICH_WEEKS_QUESTION).toBe("Which weeks? From week 2 on?");
    expect(isYes("yes")).toBe(true);
    expect(isYes("Yep.")).toBe(true);
    expect(isYes("yes but drop lunges")).toBe(false);
  });
  it("cut to the weeks the program has; rest of the program starts after the last week a client started", () => {
    expect(resolveWeeks({ kind: "weeks", from: 2, to: null }, [1, 2, 3, 4], [])).toEqual([2, 3, 4]);
    expect(resolveWeeks({ kind: "weeks", from: 3, to: 6 }, [1, 2, 3, 4], [])).toEqual([3, 4]);
    expect(resolveWeeks({ kind: "rest" }, [1, 2, 3, 4], [1, 2])).toEqual([3, 4]);
    expect(resolveWeeks({ kind: "rest" }, [1, 2, 3, 4], [])).toEqual([1, 2, 3, 4]);
  });
  it("a change to built days is an edit; a request to build more is not", () => {
    expect(isEditRequest(RON, true)).toBe(true);
    expect(isEditRequest("swap rows for pull ups from week 3", true)).toBe(true);
    expect(isEditRequest("drop goblet squats to 8 reps", false)).toBe(false);
    expect(isEditRequest("make it 4 weeks", true)).toBe(false);
    expect(isEditRequest("finish the week using Day 1", true)).toBe(false);
    expect(isEditRequest("add another week", true)).toBe(false);
    expect(isEditRequest("upper lower split, 4 days a week", true)).toBe(false);
  });
});

describe("the preview: every change, by week, and only what was named", () => {
  it("Ron's request: every day in weeks 2-4 gets the carry, and the reps drop on the two named exercises only", () => {
    const days = program();
    const plan = planWeekEdits({ changes: ronChanges, days, weeks: [2, 3, 4], youth: false });
    expect(plan.days.map((d) => `${d.week}:${d.day}`)).toEqual(["2:1", "2:2", "3:1", "3:2", "4:1", "4:2"]);
    expect(previewLines(plan)).toEqual([
      "Weeks 2-4, Day 1: add Farmer Carry 3x40 yd at the end; Goblet Squat 3x10 RPE 7 -> 3x8 RPE 7; Seated Cable Row 3x10 RPE 7 -> 3x8 RPE 7",
      "Weeks 2-4, Day 2: add Farmer Carry 3x40 yd at the end",
    ]);
    // the reps change touches only the exercises the coach named
    const changed = plan.days.flatMap((d) => d.ops).filter((o) => o.op === "change").map((o) => (o as { name: string }).name);
    expect(new Set(changed)).toEqual(new Set(["Goblet Squat", "Seated Cable Row"]));
    expect(changed).not.toContain("Plank");
  });
  it("a name that matches two exercises in a day is not guessed", () => {
    const d = day(2, 1, ["Seated Cable Row", "Bent Over Row"]);
    expect(findExercise(d.exercises, "rows")).toBeNull();
    expect(findExercise(d.exercises, "seated cable rows")?.name).toBe("Seated Cable Row");
  });
  it("a day a client has started is skipped and said so", () => {
    const days = program();
    const plan = planWeekEdits({ changes: ronChanges, days, weeks: [1, 2], youth: false });
    expect(plan.skipped).toEqual(["Week 1 Day 1 skipped, already logged", "Week 1 Day 2 skipped, already logged"]);
    expect(plan.days.every((d) => d.week === 2)).toBe(true);
  });
  it("the youth cap applies to edited and added sets (RPE 8 at most, reps outside 6-15 noted)", () => {
    const days = program();
    const changes = readAiChanges({ changes: [{ op: "change", days: [1], exercise: "Goblet Squat", rpe: 9.5 }, { op: "add", days: [1], exercise: "Box Jump", sets: 3, reps: "20", rpe: 9 }] }).changes;
    const plan = planWeekEdits({ changes, days, weeks: [2], youth: true });
    const ops = plan.days[0].ops as { rpe: number | null }[];
    expect(ops.every((o) => o.rpe === 8)).toBe(true);
    expect(plan.flags.some((f) => f.includes("Box Jump is written as 20 reps"))).toBe(true);
    // and again on the server when the plan comes back with Apply
    const back = readPlan([{ workoutId: plan.days[0].workoutId, week: 2, day: 1, ops: [{ op: "add", name: "Box Jump", sets: 3, reps: "8", rpe: 10, position: "end" }] }], true);
    expect((back[0].ops[0] as { rpe: number }).rpe).toBe(8);
  });
  it("the model's answer is read strictly (unknown ops and empty changes are dropped)", () => {
    const r = readAiChanges({ changes: [{ op: "delete_everything", exercise: "x" }, { op: "change", exercise: "Plank" }, { op: "swap", exercise: "Plank" }, { op: "remove", exercise: "Plank", days: [9] }] });
    expect(r.changes.map((c) => c.op)).toEqual(["remove"]);
  });
});

describe("nothing is written before Apply, and Apply writes only this program", () => {
  it("the preview never writes; the write is only in Apply", () => {
    const route = read("app/api/ai/edit-weeks/route.ts");
    const apply = route.indexOf('if (mode === "apply") {');
    const writes = [...route.matchAll(/applyWeekEdits\(/g)].map((m) => m.index ?? 0);
    expect(writes).toHaveLength(1);
    expect(writes[0]).toBeGreaterThan(apply);
    expect(writes[0]).toBeLessThan(route.indexOf("if (!isAiConfigured())"));
    // the days are read only from this program
    expect(route).toContain('.eq("program_id", programId);');
    const box = read("components/coach/desktop/ai-program-builder-box.tsx");
    expect(box).toContain('mode: "preview"');
    expect(box.indexOf('mode: "apply"')).toBeGreaterThan(box.indexOf("async function applyEdit()"));
  });
  it("a plan naming a day or exercise outside this program is refused; a day started since the preview is skipped", () => {
    const days = program();
    const plan = planWeekEdits({ changes: ronChanges, days, weeks: [2], youth: false }).days;
    expect(checkPlanAgainstProgram(plan, days).foreign).toBe(false);
    expect(checkPlanAgainstProgram([{ ...plan[0], workoutId: id() }], days).foreign).toBe(true);
    expect(checkPlanAgainstProgram([{ ...plan[0], ops: [{ op: "remove", exerciseId: id(), name: "x" }] }], days).foreign).toBe(true);
    const nowStarted = days.map((d) => (d.workoutId === plan[0].workoutId ? { ...d, started: true } : d));
    const again = checkPlanAgainstProgram(plan, nowStarted);
    expect(again.skipped).toEqual(["Week 2 Day 1 skipped, already logged"]);
    expect(again.plan.map((p) => p.workoutId)).not.toContain(plan[0].workoutId);
  });
});

function snapshotOf(days: PlanDay[]): Map<string, SnapshotExercise[]> {
  return new Map(days.map((d) => [d.workoutId, d.exercises.map((e) => ({ id: e.id, name: e.name, displayName: null, order: e.order, sets: e.sets.map((s) => ({ ...s, row: { id: s.id, group_workout_exercise_id: e.id, set_order: s.setOrder, target_reps: s.reps } })) }))]));
}
function fakeDb(failOn?: keyof EditDb) {
  const calls: string[] = [];
  const db: EditDb = {
    updateSet: vi.fn(async (sid, v) => (calls.push(`updateSet ${sid} ${JSON.stringify(v)}`), failOn !== "updateSet")),
    insertSets: vi.fn(async (rows) => (calls.push(`insertSets ${rows.length}`), failOn === "insertSets" ? null : rows.map(() => id()))),
    insertExercise: vi.fn(async (row) => (calls.push(`insertExercise ${row.exercise_name}`), failOn === "insertExercise" ? null : id())),
    updateExercise: vi.fn(async (eid, v) => (calls.push(`updateExercise ${eid} ${JSON.stringify(v)}`), true)),
    deleteExercises: vi.fn(async (ids) => (calls.push(`deleteExercises ${ids.length}`), failOn !== "deleteExercises")),
    deleteSets: vi.fn(async (ids) => (calls.push(`deleteSets ${ids.length}`), true)),
  };
  return { db, calls };
}

describe("Apply: all of it or none of it", () => {
  it("writes each change; the reps change updates only the named exercises' sets", async () => {
    const days = program();
    const plan = planWeekEdits({ changes: ronChanges, days, weeks: [2], youth: false }).days;
    const { db, calls } = fakeDb();
    const result = await applyWeekEdits(db, plan, snapshotOf(days), "g");
    expect(result.ok).toBe(true);
    expect(result.changedWorkoutIds).toHaveLength(2);
    const plankSets = days.find((d) => d.week === 2 && d.day === 1)!.exercises.find((e) => e.name === "Plank")!.sets.map((s) => s.id);
    expect(calls.filter((c) => c.startsWith("updateSet"))).toHaveLength(6);
    expect(calls.some((c) => plankSets.some((p) => c.includes(p)))).toBe(false);
    expect(calls.filter((c) => c === "insertExercise Farmer Carry")).toHaveLength(2);
  });
  it("a failed write puts back what was already written, and removes nothing", async () => {
    const days = program();
    const changes = readAiChanges({ changes: [{ op: "remove", days: [1], exercise: "Plank" }, { op: "change", days: [1], exercise: "Goblet Squat", reps: "8" }, { op: "add", days: [1], exercise: "Farmer Carry", sets: 3, reps: "40 yd" }] }).changes;
    const plan = planWeekEdits({ changes, days, weeks: [2], youth: false }).days;
    const { db, calls } = fakeDb("insertExercise");
    const result = await applyWeekEdits(db, plan, snapshotOf(days), "g");
    expect(result.ok).toBe(false);
    // the three sets changed to 8 are put back to 10, and the removal never ran
    expect(calls.filter((c) => c.includes('"target_reps":"10"'))).toHaveLength(3);
    expect(calls.some((c) => c.startsWith("deleteExercises"))).toBe(false);
  });
});

describe("one AI use per preview, never for a failed or empty one", () => {
  const steps = (over: Partial<Parameters<typeof chargedPreview<{ n: number }>>[0]> = {}) => ({
    canRun: vi.fn(async () => ({ ok: true })),
    ask: vi.fn(async () => ({ n: 2 })),
    hasChanges: (r: { n: number }) => r.n > 0,
    spend: vi.fn(async () => ({ ok: true })),
    ...over,
  });
  it("a preview with changes is charged once", async () => {
    const s = steps();
    expect(await chargedPreview(s)).toEqual({ ok: true, result: { n: 2 }, charged: true });
    expect(s.spend).toHaveBeenCalledTimes(1);
  });
  it("a failed call or a preview with nothing to change is not charged", async () => {
    const failed = steps({ ask: vi.fn(async () => null) });
    expect((await chargedPreview(failed)).ok).toBe(false);
    expect(failed.spend).not.toHaveBeenCalled();
    const empty = steps({ ask: vi.fn(async () => ({ n: 0 })) });
    expect(await chargedPreview(empty)).toEqual({ ok: true, result: { n: 0 }, charged: false });
    expect(empty.spend).not.toHaveBeenCalled();
    const threw = steps({ ask: vi.fn(async () => { throw new Error("timeout"); }) });
    await expect(chargedPreview(threw)).rejects.toThrow();
    expect(threw.spend).not.toHaveBeenCalled();
  });
  it("nothing is asked when it cannot be paid for", async () => {
    const s = steps({ canRun: vi.fn(async () => ({ ok: false, error: "out" })) });
    expect(await chargedPreview(s)).toEqual({ ok: false, error: "out", status: 402 });
    expect(s.ask).not.toHaveBeenCalled();
  });
  it("the route charges like a program build", () => {
    const route = read("app/api/ai/edit-weeks/route.ts");
    expect(route).toContain('canRunAiAction(supabase, user.id, "program_generation")');
    expect(route).toContain('checkAndSpendCoachCredits(createServiceRoleClient(), user.id, "program_generation")');
    expect(route).toContain('takeFreeTierUse(createServiceRoleClient(), user.id, "program")');
    expect(route).toContain('feature: "program_edit"');
  });
});

describe("the same box, computer and phone", () => {
  it("the AI Program Builder box handles a change, with Apply and Cancel", () => {
    const box = read("components/coach/desktop/ai-program-builder-box.tsx");
    expect(box).toContain("if (phase !== \"paused\" && askEdit(said)) {");
    expect(box).toContain("setLine(WHICH_WEEKS_QUESTION);");
    expect(box).toContain('{editBusy === "apply" ? "Applying…" : "Apply"}');
    expect(box).toContain("Cancel");
    // the phone reaches the same builder through Edit program (?edit=1)
    expect(read("app/(coach)/groups/[groupId]/programs/[programId]/page.tsx")).toContain("if (!searchParams.edit && (await prefersAthleteStyleView())) {");
  });
});
