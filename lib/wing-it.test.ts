import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { parseWingItLine, splitWingItText } from "./quick-entry";
import { resolveQuickAddExerciseName } from "./quick-add-name";
import { addSessionExercises, draftSetRow, draftTrackedFields } from "./add-session-exercises";

// The wing-it logger (Ron, Oct 20): a coach types or says what a client is doing, a line at a time, into a workout with no program.
const read = (p: string) => readFileSync(join(__dirname, "..", p), "utf8").replace(/\r\n/g, "\n");

describe("reading a line (parseWingItLine)", () => {
  const p = (s: string) => {
    const r = parseWingItLine(s);
    return r && { name: r.exerciseName, sets: r.sets, reps: r.reps, time: r.timeSeconds, rpe: r.rpe, weight: r.weight, unit: r.weightUnit };
  };
  it("sets x reps and a weight, in the client's unit unless one is said", () => {
    expect(p("squat 3x5 225")).toEqual({ name: "squat", sets: 3, reps: "5", time: null, rpe: null, weight: 225, unit: null });
    expect(p("bench 3x8 at 155 lbs")).toEqual({ name: "bench", sets: 3, reps: "8", time: null, rpe: null, weight: 155, unit: "lb" });
    expect(p("squat 3 by 5 100kg")).toEqual({ name: "squat", sets: 3, reps: "5", time: null, rpe: null, weight: 100, unit: "kg" });
    expect(p("deadlift 5 sets of 3 reps 315")).toEqual({ name: "deadlift", sets: 5, reps: "3", time: null, rpe: null, weight: 315, unit: null });
  });
  it("@ up to 10 is an effort; above 10 it is a weight", () => {
    expect(p("row 3x10 @8")).toEqual({ name: "row", sets: 3, reps: "10", time: null, rpe: 8, weight: null, unit: null });
    expect(p("bench 3x5 @225")).toEqual({ name: "bench", sets: 3, reps: "5", time: null, rpe: null, weight: 225, unit: null });
    expect(p("squat 3x5 225 @8")).toEqual({ name: "squat", sets: 3, reps: "5", time: null, rpe: 8, weight: 225, unit: null });
  });
  it("a timed hold is time; a bare name is one empty set; words for numbers are not guessed", () => {
    expect(p("plank 3x60")).toEqual({ name: "plank", sets: 3, reps: null, time: 60, rpe: null, weight: null, unit: null });
    expect(p("goblet squat")).toEqual({ name: "goblet squat", sets: 1, reps: null, time: null, rpe: null, weight: null, unit: null });
    expect(parseWingItLine("three sets of squats")).toBeNull();
    expect(parseWingItLine("4 sets of bench at 185 for 8")).toBeNull();
    expect(parseWingItLine("")).toBeNull();
  });
  it("splits what was typed or said into lines", () => {
    expect(splitWingItText("squat 3x5 225, bench 3x8 155;\n row 3x10 @8 ,, ")).toEqual(["squat 3x5 225", "bench 3x8 155", "row 3x10 @8"]);
  });
});

describe("the name rule moved to lib/quick-add-name.ts", () => {
  it("is the same rule, used by the builder's quick add and the wing-it box", () => {
    const lib = ["Bench Press", "Sumo Squat", "Sumo Deadlift"];
    expect(resolveQuickAddExerciseName("Bench", lib)).toEqual({ name: "Bench Press" });
    expect(resolveQuickAddExerciseName("Sumo", lib)).toEqual({ ambiguous: ["Sumo Squat", "Sumo Deadlift"] });
    expect(resolveQuickAddExerciseName("goblet squat", lib)).toEqual({ name: "Goblet Squat" });
    expect(read("components/coach/desktop/day-card.tsx")).toContain('import { resolveQuickAddExerciseName } from "@/lib/quick-add-name";');
    expect(read("components/logging/wing-it-box.tsx")).toContain("resolveQuickAddExerciseName(line.exerciseName, library)");
  });
});

describe("adding the exercises (addSessionExercises)", () => {
  function fakeDb(opts: { failExerciseNames?: string[]; failSetsFor?: string[] } = {}) {
    const exercises: any[] = [];
    const sets: any[] = [];
    const from = (table: string) => {
      let pending: any = null;
      const chain: any = {
        insert: (row: any) => {
          pending = row;
          return chain;
        },
        select: () => chain,
        single: async () => {
          if (opts.failExerciseNames?.includes(pending.exercise_name)) return { data: null, error: { message: "no" } };
          const row = { id: `se${exercises.length + 1}`, is_swapped: false, tracked_fields: pending.tracked_fields ?? ["reps", "weight"], ...pending };
          exercises.push(row);
          return { data: row, error: null };
        },
        then: (resolve: any) => {
          const rows = pending as any[];
          const se = exercises.find((e) => e.id === rows[0]?.session_exercise_id);
          if (se && opts.failSetsFor?.includes(se.exercise_name)) return resolve({ data: null, error: { message: "no" } });
          const made = rows.map((r, i) => ({ id: `${r.session_exercise_id}-s${i}`, status: "pending", rir: null, tempo: null, height: null, distance: null, rest_seconds: null, pace: null, time_seconds: null, ...r }));
          sets.push(...made);
          return resolve({ data: made, error: null });
        },
      };
      void table;
      return chain;
    };
    return { db: { from } as any, exercises, sets };
  }
  it("each line is an added exercise with its sets prefilled (pending), kilograms stored as pounds", async () => {
    const { db, exercises, sets } = fakeDb();
    const { entries, failed } = await addSessionExercises(db, "sess", 2, [
      { exerciseName: "Back Squat", sets: 3, reps: 5, weight: 100, weightUnit: "kg", rpe: null },
      { exerciseName: "Plank", sets: 3, reps: null, timeSeconds: 60, weight: null, weightUnit: "lb", rpe: null },
      { exerciseName: "Row", sets: 3, reps: 10, weight: null, weightUnit: "lb", rpe: 8 },
    ]);
    expect(failed).toBe(0);
    expect(exercises.map((e) => [e.exercise_name, e.exercise_order, e.is_added])).toEqual([["Back Squat", 2, true], ["Plank", 3, true], ["Row", 4, true]]);
    expect(exercises[0].tracked_fields).toEqual(["reps", "weight"]);
    expect(exercises[1].tracked_fields).toEqual(["time"]);
    expect(exercises[2].tracked_fields).toEqual(["reps", "weight", "rpe"]);
    expect(sets.filter((s) => s.session_exercise_id === "se1").map((s) => [s.weight, s.reps, s.status])).toEqual([[220.46, 5, "pending"], [220.46, 5, "pending"], [220.46, 5, "pending"]]);
    expect(sets.filter((s) => s.session_exercise_id === "se2").map((s) => s.time_seconds)).toEqual([60, 60, 60]);
    expect(entries).toHaveLength(3);
    expect(entries[0].sets).toHaveLength(3);
  });
  it("says how many did not save", async () => {
    const { db } = fakeDb({ failExerciseNames: ["Row"], failSetsFor: ["Plank"] });
    const { entries, failed } = await addSessionExercises(db, "sess", 0, [
      { exerciseName: "Back Squat", sets: 3, reps: 5, weight: 225, weightUnit: "lb", rpe: null },
      { exerciseName: "Plank", sets: 3, reps: null, timeSeconds: 60, weight: null, weightUnit: "lb", rpe: null },
      { exerciseName: "Row", sets: 3, reps: 10, weight: null, weightUnit: "lb", rpe: null },
    ]);
    expect(failed).toBe(2);
    expect(entries.map((e) => e.exerciseName)).toEqual(["Back Squat", "Plank"]);
  });
  it("a value past the database's limits is left blank, never sent", () => {
    expect(draftSetRow("x", 0, { exerciseName: "Squat", sets: 1, reps: 5, weight: 5000, weightUnit: "lb", rpe: null }).weight).toBeNull();
    expect(draftTrackedFields({ timeSeconds: 45, rpe: 7 })).toEqual(["time", "rpe"]);
    expect(draftTrackedFields({ timeSeconds: null, rpe: null })).toBeNull();
  });
});

describe("where it shows", () => {
  it("the client's log page offers Wing it with no program (no dead end) and under the program choices", () => {
    const page = read("app/(coach)/groups/[groupId]/athletes/[athleteId]/log/page.tsx");
    expect(page.match(/<WingItStartButton /g)?.length).toBe(2);
    expect(page).toContain("Assign a program");
    expect(page).not.toContain("assign one from");
  });
  it("the session page turns it on only for a coach-logged workout with no program", () => {
    expect(read("app/sessions/[sessionId]/page.tsx")).toContain("wingIt={session.workout_id == null && !!coachModeClient}");
    const logger = read("components/logging/session-logger.tsx");
    expect(logger).toContain("{wingIt && !isCompleted && (");
    expect(logger).toContain("Type or say what they&apos;re doing. Add more any time.");
  });
  it("the eight-extra cap is for a client's own workout only", () => {
    const logger = read("components/logging/session-logger.tsx");
    expect(logger).toContain("const atAddCap = isOwnSession && addedCount >= MAX_ADDED_EXERCISES;");
    expect(logger).not.toMatch(/addedCount >= MAX_ADDED_EXERCISES(?!;)/);
  });
  it("the start button reuses today's open wing-it workout, else starts an empty one with nothing booked or used", () => {
    const btn = read("components/logging/wing-it-start-button.tsx");
    expect(btn).toContain('.is("workout_id", null)');
    expect(btn).toContain('.eq("status", "in_progress")');
    expect(btn).toContain("p_workout_id: null,");
    expect(btn).toContain("p_deduct_session_credit: false,");
    expect(btn).toContain("p_exercises: [],");
  });
  it("Quick add still checks names and now converts kilograms and matches the library", () => {
    const nl = read("components/logging/quick-add-nl-button.tsx");
    expect(nl).toContain("exerciseNameProblem");
    expect(nl).toContain("weightUnit: unit");
    expect(nl).toContain("resolveQuickAddExerciseName(ex.exerciseName, library)");
  });
  it("what the AI heard is shown before anything is added", () => {
    const box = read("components/logging/wing-it-box.tsx");
    expect(box).toContain("Add these?");
    expect(box.indexOf("setAiDraft(data.exercises")).toBeGreaterThan(-1);
    expect(box.slice(box.indexOf("setAiDraft(data.exercises") - 200, box.indexOf("setAiDraft(data.exercises"))).not.toContain("insert(");
    expect(box).toContain('enterKeyHint="done"');
    expect(box).toContain("Keep as typed");
  });
});
