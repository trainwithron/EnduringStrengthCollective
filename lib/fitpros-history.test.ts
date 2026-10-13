import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { parseDuration, parseFitprosExport, planFitprosImport, weekOfDate, summarizePlan, markerTimestamp, isImportMarker, importKeys, normalizeExerciseName, type ProgramWorkoutInfo } from "@/lib/fitpros-history";

const SAMPLE = `# FitPros export
# Format: ## workout, exercise lines
## 2026-08-17 | Christmas Abs - Week 1 - Week1 Day 1 | 57m 44s | 5/5 | fire workout
Seated Hip CAR | 12
Bodyweight Squat Holds |  |  | 60sec
Lateral Jumps | 10,8,4
Barbell Front Squats | 5,5,5 | 205,205,205
FIRST TIME
Walking Lunges | 8,8,8 | 88,88,88
Single Leg Calf Raises (Bent Leg) | 10,10,10 | 45,45,45 |  |  | Bw on smith machine
## 2026-08-20 | Christmas Abs - Week 1 - Week 1 Day 4 | 2h 28m | 5/5 |
Box Jump | 5,5 | height 20in,20in
DB Tricep Skull Crushers | 10,10,10 | 30,30,30,1
PR
Chest Supported Row | 5,2.5,4 | 135,180,160
Single Arm Farmers Carry |  | 53,53,53 | 25yd,25yd,25yd
## 2026-09-01 | Moderate W2 Day 2 | 23h 27m | |
Chin Ups | 5,5,5 | 0,0,0
## 2026-09-02 | Mobility | | 5/5 |
Yoga Flow | 3
`;

const line = (id: string, name: string) => ({ id, name });
const PROGRAM: ProgramWorkoutInfo[] = [
  { id: "w1d1", weekNumber: 1, dayIndex: 1, title: "Day 1", exercises: [line("a", "Seated Hip CAR"), line("b", "Bodyweight Squat Holds"), line("c", "Lateral Jumps"), line("d", "Barbell Front Squats"), line("e", "Walking Lunge"), line("f", "Single Leg Calf Raises (Bent Leg)")] },
  { id: "w1d4", weekNumber: 1, dayIndex: 4, title: "Day 4", exercises: [line("g", "Box Jump"), line("h", "Dumbbell Tricep Skull Crushers"), line("i", "Chest Supported Row"), line("j", "Single Arm Farmers Carry")] },
  { id: "w2d2", weekNumber: 2, dayIndex: 2, title: "Day 2", exercises: [line("k", "Chin-Up")] },
];

describe("FitPros export reader", () => {
  const { workouts } = parseFitprosExport(SAMPLE);

  it("reads durations", () => {
    expect(parseDuration("57m 44s")).toBe(3464);
    expect(parseDuration("1h 7m")).toBe(4020);
    expect(parseDuration("")).toBeNull();
  });
  it("reads each workout, drops the rating and the workout note, skips badge lines", () => {
    expect(workouts.map((w) => w.date)).toEqual(["2026-08-17", "2026-08-20", "2026-09-01", "2026-09-02"]);
    expect(JSON.stringify(workouts)).not.toContain("fire workout");
    expect(JSON.stringify(workouts)).not.toContain("5/5");
    expect(workouts[0].exercises.map((e) => e.name)).not.toContain("FIRST TIME");
    expect(workouts[1].exercises.map((e) => e.name)).not.toContain("PR");
  });
  it("reads sets: reps, weights, a hold time, a height, a carry distance, and keeps the exercise note", () => {
    const [d1, d4] = workouts;
    expect(d1.exercises[3]).toMatchObject({ name: "Barbell Front Squats", sets: [{ reps: 5, weight: 205 }, { reps: 5, weight: 205 }, { reps: 5, weight: 205 }] });
    expect(d1.exercises[1].sets).toEqual([{ reps: null, weight: null, timeSeconds: 60, height: null, distance: null }]);
    expect(d1.exercises[5].note).toBe("Bw on smith machine");
    expect(d4.exercises[0].sets.map((s) => s.height)).toEqual([20, 20]);
    expect(d4.exercises[3].sets.map((s) => s.distance)).toEqual([25, 25, 25]);
    expect(d4.exercises[3].sets.map((s) => s.weight)).toEqual([53, 53, 53]);
  });
  it("drops a stray extra weight and a duration over 4 hours, rounds odd reps, and lists each one", () => {
    const d4 = workouts[1];
    expect(d4.exercises[1].sets.map((s) => s.weight)).toEqual([30, 30, 30]);
    expect(d4.exercises[2].sets.map((s) => s.reps)).toEqual([5, 3, 4]);
    expect(d4.flags.some((f) => f.includes("extra weight"))).toBe(true);
    expect(d4.flags.some((f) => f.includes("not a whole number"))).toBe(true);
    expect(workouts[2].durationSeconds).toBeNull();
    expect(workouts[2].flags.some((f) => f.includes("timer left running"))).toBe(true);
    expect(workouts[0].durationSeconds).toBe(3464);
  });
});

describe("Matching to the program", () => {
  const { workouts } = parseFitprosExport(SAMPLE);
  it("finds the program day by the exercise list, not the label, and the week by the date from the program start", () => {
    const plan = planFitprosImport(workouts, PROGRAM, "2026-08-17");
    expect(plan[0]).toMatchObject({ dayIndex: 1, weekNumber: 1, programWorkoutId: "w1d1" });
    expect(plan[1]).toMatchObject({ dayIndex: 4, weekNumber: 1, programWorkoutId: "w1d4" });
    expect(plan[2]).toMatchObject({ dayIndex: null, weekNumber: null, programWorkoutId: null });
    expect(plan[2].flags.join(" ")).toContain("not in the program");
  });
  it("links each line to the program's own exercise (walking lunges -> Walking Lunge, DB -> Dumbbell) and keeps unknown names as written", () => {
    const plan = planFitprosImport(workouts, PROGRAM, "2026-08-17");
    const lunge = plan[0].exercises.find((e) => e.name === "Walking Lunges");
    expect(lunge).toMatchObject({ savedName: "Walking Lunge", programExerciseId: "e" });
    expect(plan[1].exercises.find((e) => e.name === "DB Tricep Skull Crushers")).toMatchObject({ savedName: "Dumbbell Tricep Skull Crushers", programExerciseId: "h" });
    expect(plan[3].exercises[0]).toMatchObject({ savedName: "Yoga Flow", programExerciseId: null });
  });
  it("a workout that matches no program day, or a program with no start date, is plain history with a reason", () => {
    expect(planFitprosImport(workouts, PROGRAM, "2026-08-17")[3]).toMatchObject({ programWorkoutId: null, dayIndex: null });
    expect(planFitprosImport(workouts, PROGRAM, "2026-08-17")[3].flags.join(" ")).toContain("matches no program day");
    const none = planFitprosImport(workouts, PROGRAM, null);
    expect(none.every((p) => p.programWorkoutId === null)).toBe(true);
  });
  it("a program that starts after the workout (the start date not moved back) is not linked", () => {
    const plan = planFitprosImport(workouts, PROGRAM, "2026-10-12");
    expect(plan[0].programWorkoutId).toBeNull();
  });
  it("counts weeks from the start date", () => {
    expect(weekOfDate("2026-08-17", "2026-08-17")).toBe(1);
    expect(weekOfDate("2026-08-17", "2026-08-23")).toBe(1);
    expect(weekOfDate("2026-08-17", "2026-08-24")).toBe(2);
    expect(weekOfDate("2026-08-17", "2026-10-08")).toBe(8);
    expect(weekOfDate("2026-08-17", "2026-10-12")).toBe(9);
  });
  it("summarizes the plan", () => {
    const s = summarizePlan(planFitprosImport(workouts, PROGRAM, "2026-08-17"));
    expect(s.workouts).toBe(4);
    expect(s.linked).toBe(2);
    expect(s.unlinked).toBe(2);
  });
  it("normalizes names the way the library spells them", () => {
    expect(normalizeExerciseName("Lat Pull Down")).toBe(normalizeExerciseName("Lat Pulldown"));
    expect(normalizeExerciseName("Chin Ups")).toBe(normalizeExerciseName("Chin-Up"));
    expect(normalizeExerciseName("Conventional Deadlifts")).toBe(normalizeExerciseName("Conventional Deadlift"));
  });
});

describe("Recognising an import again", () => {
  it("stamps the Nth workout of a day with its own marker second, and only those seconds count", () => {
    expect(markerTimestamp("2026-09-03", 0)).toBe("2026-09-03T12:00:17Z");
    expect(markerTimestamp("2026-09-03", 1)).toBe("2026-09-03T12:00:18Z");
    expect(isImportMarker("2026-09-03T12:00:18+00:00")).toBe(true);
    expect(isImportMarker("2026-09-03T12:00:00+00:00")).toBe(false);
    expect(isImportMarker(null)).toBe(false);
  });
  it("keys a second workout on the same day apart", () => {
    expect(importKeys([{ date: "a" }, { date: "a" }, { date: "b" }])).toEqual(["a#0", "a#1", "b#0"]);
  });
});

describe("The importer writes history only, and says so", () => {
  const src = (rel: string) => readFileSync(join(__dirname, "..", rel), "utf8").replace(/\r\n/g, "\n");
  it("never writes a workout log, a personal record, a credit, a post or a notification", () => {
    const code = src("lib/fitpros-history-import.ts");
    expect(code).not.toContain('from("workout_logs")');
    expect(code).not.toContain("exercise_records");
    expect(code).not.toContain("complete_workout_session");
    expect(code).not.toContain("notifications");
    expect(code).not.toContain("posts");
    expect(code).toContain("is_historical: true");
  });
  it("undo only deletes sessions that are flagged historical and carry the import marker", () => {
    const code = src("lib/fitpros-history-import.ts");
    expect(code).toContain('.eq("is_historical", true)');
    expect(code).toContain("isImportMarker(started)");
  });
  it("the history page shows the importer, with a dry run before Import and an Undo", () => {
    expect(src("app/(coach)/groups/[groupId]/athletes/[athleteId]/history/page.tsx")).toContain("<HistoryImportPicker");
    expect(src("components/coach/history-import-picker.tsx")).toContain("<FitprosHistoryImport");
    const ui = src("components/coach/fitpros-history-import.tsx");
    expect(ui).toContain("nothing is saved until you press Import");
    expect(ui).toContain("Undo this import");
    expect(ui).toContain("Move the program start to");
  });
});

describe("Only the import's own stamp counts as an import", () => {
  it("a historical entry at another time (or the same seconds at another minute or hour) is never taken for one", () => {
    expect(isImportMarker("2026-09-03T12:00:17+00:00")).toBe(true);
    expect(isImportMarker("2026-09-03T12:00:19")).toBe(true);
    expect(isImportMarker("2026-09-03T12:00:00+00:00")).toBe(false);
    expect(isImportMarker("2026-09-03T12:00:20+00:00")).toBe(false);
    expect(isImportMarker("2026-09-03T09:30:18+00:00")).toBe(false);
    expect(isImportMarker("2026-09-03T12:05:17+00:00")).toBe(false);
    expect(isImportMarker("2026-09-03T12:00:17-07:00")).toBe(false);
  });
});

describe("Moving the program start is checked, never assumed", () => {
  const src = (rel: string) => readFileSync(join(__dirname, "..", rel), "utf8").replace(/\r\n/g, "\n");
  const ui =src("components/coach/fitpros-history-import.tsx");
  const lib = src("lib/fitpros-history-import.ts");
  it("moveProgramStart reports the stored date and null unless it is the date asked for", () => {
    expect(lib).toContain('.select("id, start_date")');
    expect(lib).toContain("return stored === startDate ? stored : null;");
  });
  it("the import moves the start first, stops loudly if it did not move, and plans again from the start it really has", () => {
    expect(ui).toContain("if (stored !== firstDate)");
    expect(ui).toContain("did NOT move to");
    expect(ui).toContain("const finalPlan = planFitprosImport(workouts, program.workouts, start,");
    expect(ui).toContain("plan: finalPlan");
  });
  it("it warns in red when the workouts come before the program start and the start is not being moved", () => {
    expect(ui).toContain("before the program starts");
    expect(ui).toContain("Tick the box below to move the start");
  });
  it("the page has ONE Import button that asks where the history is from, and no source is named in the page itself", () => {
    const picker = src("components/coach/history-import-picker.tsx");
    expect(picker).toContain("Where is the history from?");
    expect(picker.match(/^\s+Import$/gm)?.length).toBe(1);
    expect(picker).toContain("Other (CSV or Excel)");
    expect(src("app/(coach)/groups/[groupId]/athletes/[athleteId]/history/page.tsx")).not.toContain("FitPros");
  });
});
