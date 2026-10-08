import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { parseDurationSeconds, isTimedHold, normalizeTimedRow } from "@/lib/timed-exercise";
import { parseImportRows, detectColumns } from "@/lib/workout-import-parser";
import { normalizeRows } from "@/lib/program-import-request";
import { TRACKED_FIELD_DEFS } from "@/lib/exercise-fields";

describe("parseDurationSeconds", () => {
  it.each([
    ["60s", 60],
    ["60 sec", 60],
    ["60 secs", 60],
    ["60 seconds", 60],
    ["45 Seconds", 45],
    ["1 min", 60],
    ["1 minute", 60],
    ["5 minutes", 300],
    ["1.5 min", 90],
    ["1:00", 60],
    ["1:30", 90],
    ["10:00", 600],
  ])("%s is %i seconds", (text, seconds) => {
    expect(parseDurationSeconds(text)).toBe(seconds);
  });
  it("a bare number, a rep scheme or words are not durations", () => {
    for (const t of ["60", "3x10", "8-12", "AMRAP", "", "1:75", "5m", "abc"]) expect(parseDurationSeconds(t)).toBeNull();
    expect(parseDurationSeconds(null)).toBeNull();
  });
});

describe("isTimedHold", () => {
  it("knows the usual holds", () => {
    for (const n of ["Plank", "planks", "Side Plank", "Wall Sit", "Dead Hang", "Hollow Hold", "Hollow Body Hold", "L-Sit", "Isometric Split Squat Hold", "Copenhagen Plank", "Bar Hang"]) {
      expect(isTimedHold(n), n).toBe(true);
    }
  });
  it("moving planks and everything else are counted in reps", () => {
    for (const n of ["Plank Row", "Plank Jack", "Plank to Pushup", "Plank Walkout", "Squat", "Bench Press", "Farmer Carry", "Pull-Up", "Row"]) {
      expect(isTimedHold(n), n).toBe(false);
    }
  });
});

describe("normalizeTimedRow", () => {
  const row = (exerciseName: string, reps: string | null, timeSeconds: number | null = null) => ({ exerciseName, reps, timeSeconds, sets: 3 });
  it("a duration in the reps place becomes the time", () => {
    expect(normalizeTimedRow(row("Plank", "60 sec"))).toMatchObject({ reps: null, timeSeconds: 60 });
    expect(normalizeTimedRow(row("Row", "5 min"))).toMatchObject({ reps: null, timeSeconds: 300 });
  });
  it("a bare number on a timed hold is seconds; on anything else it stays reps", () => {
    expect(normalizeTimedRow(row("Plank", "60"))).toMatchObject({ reps: null, timeSeconds: 60 });
    expect(normalizeTimedRow(row("Squat", "60"))).toMatchObject({ reps: "60", timeSeconds: null });
    expect(normalizeTimedRow(row("Plank", "3"))).toMatchObject({ reps: "3", timeSeconds: null });
  });
  it("a row that already has a time, or no reps, or a rep range is left alone", () => {
    const withTime = row("Plank", "10", 45);
    expect(normalizeTimedRow(withTime)).toBe(withTime);
    const noReps = row("Plank", null);
    expect(normalizeTimedRow(noReps)).toBe(noReps);
    expect(normalizeTimedRow(row("Squat", "8-12"))).toMatchObject({ reps: "8-12", timeSeconds: null });
  });
});

describe("the same everywhere: spreadsheet, AI reader, generated program", () => {
  it("a spreadsheet row with 60 sec in Reps, or a bare 60 on a plank, imports as a time; 3x10 squats stay reps", () => {
    const mapping = detectColumns(["Day", "Exercise", "Sets", "Reps"]);
    const rows = parseImportRows(
      [
        ["Day 1", "Plank", "3", "60 sec"],
        ["Day 1", "Wall Sit", "3", "45"],
        ["Day 1", "Squat", "3", "10"],
        ["Day 1", "Side plank", "2", "1 min"],
      ],
      mapping
    );
    expect(rows[0]).toMatchObject({ exerciseName: "Plank", sets: 3, reps: null, timeSeconds: 60 });
    expect(rows[1]).toMatchObject({ reps: null, timeSeconds: 45 });
    expect(rows[2]).toMatchObject({ exerciseName: "Squat", reps: "10", timeSeconds: null });
    expect(rows[3]).toMatchObject({ reps: null, timeSeconds: 60 });
  });
  it("the AI reader's rows get the same treatment, even if the model put the time in reps", () => {
    const rows = normalizeRows([
      { week: "Week 1", day: "Day 1", exerciseName: "Plank", sets: 3, reps: "60 seconds" },
      { week: "Week 1", day: "Day 1", exerciseName: "Plank", sets: 3, reps: null, timeSeconds: 60 },
      { week: "Week 1", day: "Day 1", exerciseName: "Squat", sets: 3, reps: 10 },
    ]);
    expect(rows[0]).toMatchObject({ reps: null, timeSeconds: 60 });
    expect(rows[1]).toMatchObject({ reps: null, timeSeconds: 60 });
    expect(rows[2]).toMatchObject({ reps: "10", timeSeconds: null });
  });
});

const read = (p: string) => readFileSync(resolve(__dirname, p), "utf8").replace(/\r\n/g, "\n");

describe("what the builder and the logger do with a timed exercise", () => {
  const dayCard = read("../components/coach/desktop/day-card.tsx");
  const wizard = read("../components/coach/desktop/import-wizard.tsx");
  const generate = read("../app/api/ai/generate-program/route.ts");
  it("the quick-add line saves the time and tracks Time (not reps) for a timed exercise", () => {
    expect(dayCard).toContain('...(parsed.timeSeconds != null ? { tracked_fields: ["time", ...(parsed.rpe != null ? ["rpe"] : [])] } : {})');
    expect(dayCard).toContain("target_time_seconds: parsed.timeSeconds,");
    expect(dayCard).toContain("target_reps: parsed.reps,");
    expect(dayCard).toContain('parsed.eachSide ? "Each side" : null');
  });
  it("the import review shows the time where reps would be, and a timed exercise with no reps tracks Time instead of reps", () => {
    expect(wizard).toContain('ex.reps ?? (ex.timeSeconds != null ? `${ex.timeSeconds}s` : "?")');
    expect(wizard).toContain('DEFAULT_TRACKED_FIELDS.filter((f) => f !== "reps")');
    expect(wizard).toContain("target_time_seconds: ex.timeSeconds");
  });
  it("a generated program's rows are normalized too", () => {
    expect(generate).toContain("normalizeTimedRow(");
  });
  it("the logger copies the exercise's tracked fields, and Time is one it knows how to show (a time field)", () => {
    expect(read("../components/logging/start-workout-button.tsx")).toContain("tracked_fields: ex.trackedFields");
    expect(TRACKED_FIELD_DEFS.some((f) => f.key === "time" && f.kind === "number")).toBe(true);
  });
});
