import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { dailyBestByExercise, hindsightPrs, importedTotals, importedWorkouts, parseRollup, type RollupRow } from "@/lib/imported-prs";

const read = (p: string) => readFileSync(join(__dirname, "..", p), "utf8").replace(/\r\n/g, "\n");

let n = 0;
const row = (at: string, exerciseName: string, bestWeight: number | null, extra: Partial<RollupRow> = {}): RollupRow => ({
  sessionId: extra.sessionId ?? `s${++n}`,
  at: `${at}T12:00:17.000Z`,
  exerciseName,
  bestWeight,
  bestE1rm: null,
  volume: (bestWeight ?? 0) * 5,
  sets: 1,
  imported: true,
  hasLog: false,
  ...extra,
});

describe("records found in hindsight", () => {
  it("a record is the heaviest weight so far, in date order, whatever order the rows come in", () => {
    const rows = [
      row("2025-03-01", "Deadlift", 400),
      row("2025-01-01", "Deadlift", 300),
      row("2025-02-01", "Deadlift", 350),
      row("2025-04-01", "Deadlift", 380), // lighter than the best so far: not a record
    ];
    expect(hindsightPrs(rows).map((p) => [p.date.slice(0, 10), p.weight])).toEqual([
      ["2025-03-01", 400],
      ["2025-02-01", 350],
    ]);
  });
  it("the first time an exercise appears is not a record, a weight of zero or nothing never is, a tie is not", () => {
    expect(hindsightPrs([row("2025-01-01", "Squat", 200)])).toEqual([]);
    expect(hindsightPrs([row("2025-01-01", "Pull-Up", 0), row("2025-02-01", "Pull-Up", 0)])).toEqual([]);
    expect(hindsightPrs([row("2025-01-01", "Squat", 200), row("2025-02-01", "Squat", null)])).toEqual([]);
    expect(hindsightPrs([row("2025-01-01", "Squat", 200), row("2025-02-01", "Squat", 200)])).toEqual([]);
  });
  it("names match ignoring case, and each exercise has its own history", () => {
    const rows = [row("2025-01-01", "Back Squat", 200), row("2025-02-01", "back squat ", 210), row("2025-02-01", "Bench", 300)];
    expect(hindsightPrs(rows).map((p) => p.exerciseName)).toEqual(["back squat "]);
  });
  it("a live workout's records are not re-found (they were celebrated at the time), but its weights are what an import must beat", () => {
    const rows = [
      row("2025-01-01", "Squat", 300, { imported: false, hasLog: true }),
      row("2025-02-01", "Squat", 250), // imported, lighter than the live 300: not a record
      row("2025-03-01", "Squat", 320), // imported, beats the live 300
      row("2025-04-01", "Squat", 330, { imported: false, hasLog: true }), // live record: not listed here
    ];
    expect(hindsightPrs(rows).map((p) => p.weight)).toEqual([320]);
  });
  it("an imported workout that was promoted (it has a workout log) is judged as a live one: not listed here", () => {
    const rows = [row("2025-01-01", "Squat", 200), row("2025-02-01", "Squat", 250, { hasLog: true })];
    expect(hindsightPrs(rows)).toEqual([]);
  });
  it("two exercises of one workout are judged against what came before the workout, not each other", () => {
    const rows = [row("2025-01-01", "Press", 100, { sessionId: "a" }), row("2025-02-01", "Press", 110, { sessionId: "b" }), row("2025-02-01", "Press", 120, { sessionId: "b" })];
    // two rows for the same exercise in one workout cannot happen in the database (one row per workout and exercise), but the judging still must not compare a row with its own workout
    expect(hindsightPrs(rows).map((p) => p.weight)).toEqual([110, 120]);
  });
});

describe("imported workouts, one entry each", () => {
  it("when and how much, for the imported workouts that have no log of their own", () => {
    const rows = [
      row("2025-01-01", "Squat", 100, { sessionId: "i1" }),
      row("2025-01-01", "Bench", 100, { sessionId: "i1" }),
      row("2025-02-01", "Squat", 100, { sessionId: "i2" }),
      row("2025-04-01", "Squat", 100, { sessionId: "promoted", hasLog: true }),
      row("2025-03-01", "Squat", 100, { sessionId: "live", imported: false, hasLog: true }),
    ];
    const list = importedWorkouts(rows);
    expect(list.map((w) => [w.sessionId, w.volume])).toEqual([
      ["i1", 1000],
      ["i2", 500],
    ]);
    expect(list[0].at.slice(0, 10)).toBe("2025-01-01");
    expect(importedWorkouts([])).toEqual([]);
  });
});

describe("totals", () => {
  it("imported workouts without a log add to the workout count and the volume; live ones and promoted ones do not (they are in the logs)", () => {
    const rows = [
      row("2025-01-01", "Squat", 100, { sessionId: "i1" }),
      row("2025-01-01", "Bench", 100, { sessionId: "i1" }),
      row("2025-02-01", "Squat", 100, { sessionId: "i2" }),
      row("2025-03-01", "Squat", 100, { sessionId: "live", imported: false, hasLog: true }),
      row("2025-04-01", "Squat", 100, { sessionId: "promoted", hasLog: true }),
    ];
    expect(importedTotals(rows)).toEqual({ workouts: 2, volume: 1500 });
    expect(importedTotals([])).toEqual({ workouts: 0, volume: 0 });
  });
});

describe("the graph data", () => {
  it("the best weight of each day per exercise, oldest first, unloaded sets left out", () => {
    const rows = [row("2025-02-01", "Squat", 210), row("2025-01-01", "Squat", 200), row("2025-02-01", "Squat", 215), row("2025-01-01", "Pull-Up", 0)];
    expect(dailyBestByExercise(rows)).toEqual({
      Squat: [
        { date: "2025-01-01", value: 200 },
        { date: "2025-02-01", value: 215 },
      ],
    });
  });
});

describe("reading the database rows", () => {
  it("numbers arrive as text from the database and are turned back into numbers", () => {
    const [r] = parseRollup([{ session_id: "a", at: "2025-01-01T12:00:17+00:00", exercise_name: "Squat", best_weight: "200.0", best_e1rm: "240.0", volume: "3000", sets: 3, imported: true, has_log: false }]);
    expect(r).toEqual({ sessionId: "a", at: "2025-01-01T12:00:17+00:00", exerciseName: "Squat", bestWeight: 200, bestE1rm: 240, volume: 3000, sets: 3, imported: true, hasLog: false });
    expect(parseRollup(null)).toEqual([]);
    expect(parseRollup([{ session_id: "a", at: "x", exercise_name: "Curl", best_weight: null, best_e1rm: null, volume: 0, sets: 1, imported: false, has_log: true }])[0].bestWeight).toBeNull();
  });
});

describe("the profile uses it", () => {
  const page = read("app/(coach)/groups/[groupId]/athletes/[athleteId]/page.tsx");
  it("totals and records add the imported history to the logged workouts, in the first wait", () => {
    expect(page).toContain('supabase.rpc("client_exercise_rollup"');
    expect(page).toContain("...importedList.map((w) => ({ date: dateKeyInZone(w.at, displayZone), volume: w.volume })),");
    expect(page).toContain("hindsightPrs(rollup)");
    expect(page).not.toContain("Includes imported history");
  });
  it("the cards and graphs are built from the same rows, never from set logs read on the page", () => {
    expect(page).toContain("planCards(summarizeExercises(rollup)");
    expect(page).not.toContain('.from("set_logs")');
  });
});
