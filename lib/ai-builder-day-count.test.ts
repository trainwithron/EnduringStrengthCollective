import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { parseBuildRequest, planSlots } from "@/lib/ai-day-request";
import { mergeFlags, scanConstraints } from "@/lib/constraint-scan";

// Ron, Nov 23 (live, from his tablet): the AI Program Builder built 3 days for a 5-day split, and "Worth a look" said "Week 1 has 1 training days, but your description asked
// for 3 a week." three times.
const read = (p: string) => readFileSync(join(__dirname, "..", p), "utf8").replace(/\r\n/g, "\n");
const RON = "okay 5-day split we're going to do 3 days a week full body with an emphasis on glutes arms and abs on the days in between the full body lifts let's do core cardio and Mobility";
const day = (week: number, d: number, name = "Back Squat") => ({ week: `Week ${week}`, day: `Day ${d}`, exerciseName: name, sets: 3, reps: "8", weight: null, rpe: null, rest: null, timeSeconds: null }) as never;

describe("a named N-day split is the week's shape", () => {
  it("Ron's sentence is 5 days a week, and 5 days get built", () => {
    expect(parseBuildRequest(RON).daysPerWeek).toBe(5);
    expect(planSlots([], parseBuildRequest(RON), null)).toHaveLength(5);
  });
  it("the scan reads 5 too: a full week of 5 days is not flagged, 3 days is", () => {
    const five = [1, 2, 3, 4, 5].map((d) => day(1, d));
    expect(scanConstraints(RON, five).filter((f) => f.includes("training days"))).toEqual([]);
    expect(scanConstraints(RON, five.slice(0, 3))).toContain("Week 1 has 3 training days, but your description asked for 5 a week.");
  });
  it("the old cases still hold", () => {
    expect(parseBuildRequest("3 days a week").daysPerWeek).toBe(3);
    expect(parseBuildRequest("a 4-day split").daysPerWeek).toBe(4);
    expect(parseBuildRequest("4 day program, 6 weeks")).toMatchObject({ daysPerWeek: 4, weeks: 6 });
    expect(parseBuildRequest("3x a week for a month")).toMatchObject({ daysPerWeek: 3, weeks: 4 });
    expect(scanConstraints("3 days a week", [day(1, 1), day(1, 2)])).toContain("Week 1 has 2 training days, but your description asked for 3 a week.");
    expect(scanConstraints("4-day split", [1, 2, 3].map((d) => day(1, d)))).toContain("Week 1 has 3 training days, but your description asked for 4 a week.");
  });
});

describe("a day built on its own is never told it has 1 training day", () => {
  it("the single-day scan skips the days-a-week count, and keeps the other checks", () => {
    expect(scanConstraints("3 days a week", [day(1, 1)], { weekCount: false })).toEqual([]);
    expect(scanConstraints("3 days a week, no jumping", [day(1, 1, "Box Jump")], { weekCount: false })).toEqual(['"Box Jump" (Week 1, Day 1) conflicts with "no jumping" in your description.']);
  });
  it("build-day scans with weekCount: false; the whole-week routes keep the count", () => {
    const buildDay = read("app/api/ai/build-day/route.ts");
    expect(buildDay.match(/scanConstraints\(/g)).toHaveLength(2);
    expect(buildDay.match(/\{ weekCount: false \}\)/g)).toHaveLength(2);
    expect(read("app/api/ai/generate-program/route.ts")).not.toContain("weekCount");
    expect(read("app/api/ai/pick-template/route.ts")).not.toContain("weekCount");
  });
});

describe("a flag is shown once", () => {
  it("merging each day's flags never repeats a line, keeps the newest last, at most 6", () => {
    const a = "Week 1 has 1 training days, but your description asked for 3 a week.";
    expect(mergeFlags(mergeFlags(mergeFlags([], [a]), [a]), [a])).toEqual([a]);
    expect(mergeFlags(["x", "y"], ["x", "z"])).toEqual(["y", "x", "z"]);
    expect(mergeFlags([], ["1", "2", "3", "4", "5", "6", "7"])).toEqual(["2", "3", "4", "5", "6", "7"]);
  });
  it("the builder merges each day's flags and shows them once", () => {
    const box = read("components/coach/desktop/ai-program-builder-box.tsx");
    expect(box).toContain("setFlags((prev) => mergeFlags(prev, result.flags))");
    expect(box).toContain("setFlags((prev) => mergeFlags(prev, fixed.flags))");
    expect(box).toContain("Worth a look: {mergeFlags([], flags).slice(-3).join(");
    expect(box).toContain("Worth a look: {mergeFlags([], preview.flags).join(");
    expect(box).not.toMatch(/\[\.\.\.prev, \.\.\.\w+\.flags\]/);
  });
});
