import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { clampAiRow, clampReps } from "@/lib/ai-row-clamps";
import { normalizeRows } from "@/lib/program-import-request";
import { readDayResult } from "@/lib/ai-day-run";

const read = (rel: string) => readFileSync(join(__dirname, "..", rel), "utf8").replace(/\r\n/g, "\n");
const row = (over: Partial<Parameters<typeof clampAiRow>[0]> = {}) => ({ sets: 3, reps: "8", weight: null, rpe: null, rest: null, timeSeconds: null, ...over });

describe("What the AI writes is held to sane limits on the server", () => {
  it("sets stay between 1 and 20", () => {
    expect(clampAiRow(row({ sets: 500 })).sets).toBe(20);
    expect(clampAiRow(row({ sets: 0 })).sets).toBe(1);
    expect(clampAiRow(row({ sets: -3 })).sets).toBe(1);
    expect(clampAiRow(row({ sets: 3.6 })).sets).toBe(4);
  });
  it("effort (RPE) stays between 1 and 10, in half steps", () => {
    expect(clampAiRow(row({ rpe: 15 })).rpe).toBe(10);
    expect(clampAiRow(row({ rpe: 0 })).rpe).toBe(1);
    expect(clampAiRow(row({ rpe: 8.3 })).rpe).toBe(8.5);
    expect(clampAiRow(row({ rpe: null })).rpe).toBeNull();
  });
  it("a rep count is held to 1..100 inside the text; words and ranges are kept", () => {
    expect(clampReps("8")).toBe("8");
    expect(clampReps("8-10")).toBe("8-10");
    expect(clampReps("AMRAP")).toBe("AMRAP");
    expect(clampReps("400m")).toBe("400m");
    expect(clampReps("30 sec")).toBe("30 sec");
    expect(clampReps("30-60 sec")).toBe("30-60 sec");
    expect(clampReps("200 yd")).toBe("200 yd");
    expect(clampReps("150 cal")).toBe("150 cal");
    expect(clampReps("9999")).toBe("100");
    expect(clampReps("10 each side")).toBe("10 each side");
    expect(clampReps("10 each side")).toBe("10 each side");
    expect(clampReps("5000")).toBe("100");
    expect(clampReps("0")).toBe("1");
    expect(clampReps("  ")).toBeNull();
  });
  it("an impossible weight or time is dropped to empty, a real one is kept", () => {
    expect(clampAiRow(row({ weight: 99999 })).weight).toBeNull();
    expect(clampAiRow(row({ weight: -5 })).weight).toBeNull();
    expect(clampAiRow(row({ weight: 225 })).weight).toBe(225);
    expect(clampAiRow(row({ timeSeconds: 500000 })).timeSeconds).toBeNull();
    expect(clampAiRow(row({ timeSeconds: 60 })).timeSeconds).toBe(60);
  });
  it("applies to every way the AI produces rows: generated programs, photo/PDF/text reading, and the day builder", () => {
    const parsed = normalizeRows([{ week: "Week 1", day: "Day 1", exerciseName: "Squat", sets: 999, reps: "9999", weight: 90000, rpe: 14 }]);
    expect(parsed[0]).toMatchObject({ sets: 20, reps: "100", weight: null, rpe: 10 });
    const day = readDayResult({ title: "Lower", exercises: [{ exerciseName: "Squat", sets: 400, reps: "5", weight: null, rpe: 99, rest: null, timeSeconds: null }] }, "Day 1");
    expect(day?.exercises[0]).toMatchObject({ sets: 20, rpe: 10 });
    expect(read("app/api/ai/generate-program/route.ts")).toContain("clampAiRow(normalizeTimedRow(");
  });
});
