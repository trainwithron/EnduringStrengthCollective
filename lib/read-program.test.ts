import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { planParts, READ_IN_TWO_UP_TO, READ_WHOLE_UP_TO } from "@/lib/program-text-split";
import { readProgram, type PartsDeps } from "@/lib/read-in-parts";
import type { ParsedImportRow } from "@/lib/workout-import-parser";

const read = (rel: string) => readFileSync(join(__dirname, "..", rel), "utf8").replace(/\r\n/g, "\n");
class Truncated extends Error {}

// Weeks of plain program text, each about 1,000 characters.
const week = (n: number) => `Week ${n}\n` + Array.from({ length: 16 }, (_, i) => `Day ${(i % 4) + 1} exercise ${i + 1}: Back Squat 4x5 @ 70 percent, rest 120s, note ${n}`).join("\n");
const program = (weeks: number) => Array.from({ length: weeks }, (_, i) => week(i + 1)).join("\n\n");

describe("deciding the parts from the size, before any read", () => {
  it("short stays whole, medium is two, long is four, and the parts put back together are the program", () => {
    const small = program(5);
    const medium = program(20);
    const long = program(45);
    expect(small.length).toBeLessThanOrEqual(READ_WHOLE_UP_TO);
    expect(medium.length).toBeGreaterThan(READ_WHOLE_UP_TO);
    expect(medium.length).toBeLessThanOrEqual(READ_IN_TWO_UP_TO);
    expect(long.length).toBeGreaterThan(READ_IN_TWO_UP_TO);
    expect(planParts(small)).toHaveLength(1);
    expect(planParts(medium)).toHaveLength(2);
    expect(planParts(long)).toHaveLength(4);
    for (const text of [medium, long]) {
      expect(planParts(text).join("\n\n").replace(/\s+/g, " ")).toBe(text.trim().replace(/\s+/g, " "));
    }
  });
  it("every part starts at a week", () => {
    for (const p of planParts(program(45))) expect(p.startsWith("Week ")).toBe(true);
  });
  it("a 30,000-character program with no week lines is read as ONE part (never cut mid-week or mid-day)", () => {
    const noWeeks = Array.from({ length: 500 }, (_, i) => `Squat day ${i}: Back Squat 4x5 at 70 percent with a long note to fill the line up nicely`).join("\n");
    expect(noWeeks.length).toBeGreaterThan(READ_IN_TWO_UP_TO - 5000);
    expect(planParts(noWeeks + "\n" + noWeeks.slice(0, 8000))).toHaveLength(1);
  });
  it("a program whose only week line is near the end is not cut mid-week", () => {
    const body = Array.from({ length: 300 }, (_, i) => `Day ${i}: Back Squat 4x5 at 70 percent with a long note to fill the line up nicely`).join("\n");
    const text = `Week 1\n${body}\nWeek 2\nDay 1: Deadlift 3x5`;
    expect(text.length).toBeGreaterThan(READ_WHOLE_UP_TO);
    const parts = planParts(text);
    for (const p of parts) expect(p.startsWith("Week ")).toBe(true);
    expect(parts.join("\n").replace(/\s+/g, " ")).toBe(text.replace(/\s+/g, " "));
  });
  it("with only a few week lines it makes fewer parts, each starting at a week", () => {
    const text = [1, 2, 3].map((n) => week(n) + "\n" + Array.from({ length: 80 }, (_, i) => `extra line ${i} with some padding words here`).join("\n")).join("\n\n").repeat(1);
    const bigText = text + "\n\n" + text.replace(/Week (\d)/g, "Week 1$1");
    const parts = planParts(bigText);
    expect(parts.length).toBeLessThanOrEqual(4);
    for (const p of parts) expect(p.startsWith("Week ")).toBe(true);
  });
});

describe("reading the parts at the same time", () => {
  function reader(opts: { ms: number; clock: { t: number }; truncateAbove?: number; truncateIf?: (text: string) => boolean }) {
    let running = 0;
    let maxRunning = 0;
    const order: string[] = [];
    const fn: PartsDeps["read"] = async (text) => {
      running += 1;
      maxRunning = Math.max(maxRunning, running);
      order.push(text.slice(0, 7));
      await new Promise((r) => setTimeout(r, 5));
      running -= 1;
      opts.clock.t += opts.ms;
      const weeks = (text.match(/^Week \d+/gm) ?? []).length;
      if ((opts.truncateAbove != null && weeks > opts.truncateAbove) || opts.truncateIf?.(text)) throw new Truncated();
      const rows: ParsedImportRow[] = [];
      for (const m of text.matchAll(/^Week (\d+)/gm)) rows.push({ week: `Week ${m[1]}`, day: "Day 1", exerciseName: "Back Squat", sets: 4, reps: "5", weight: null, rpe: null, rest: null, timeSeconds: null });
      return rows;
    };
    return { fn, stats: () => ({ maxRunning, order }) };
  }
  const deps = (clock: { t: number }, fn: PartsDeps["read"]): PartsDeps => ({ read: fn, isTruncated: (e) => e instanceof Truncated, now: () => clock.t, deadlineAt: 240_000, defaultReadMs: 60_000, maxDepth: 2 });

  it("a long program is read in four parts at once, in order, with no wasted first read", async () => {
    const clock = { t: 0 };
    const r = reader({ ms: 1000, clock });
    const out = await readProgram(program(45), deps(clock, r.fn));
    if (out === "not_a_list") throw new Error("unexpected");
    expect(r.stats().maxRunning).toBe(4);
    expect(out.parts).toBe(4);
    expect(out.rows.map((x) => x.week)).toEqual(Array.from({ length: 45 }, (_, i) => `Week ${i + 1}`));
    expect(out.stoppedEarly).toBe(false);
  });
  it("a short program is one read", async () => {
    const clock = { t: 0 };
    const r = reader({ ms: 1000, clock });
    const out = await readProgram(program(5), deps(clock, r.fn));
    if (out === "not_a_list") throw new Error("unexpected");
    expect(r.stats().order).toHaveLength(1);
    expect(out.parts).toBe(1);
  });
  it("a medium program in two parts may split once more if a part is cut off, never more than the per-minute limit", async () => {
    const clock = { t: 0 };
    const r = reader({ ms: 1000, clock, truncateAbove: 6 });
    const out = await readProgram(program(20), deps(clock, r.fn));
    if (out === "not_a_list") throw new Error("unexpected");
    expect(out.rows).toHaveLength(20);
    expect(r.stats().order.length).toBeLessThanOrEqual(6);
  });
  it("four parts do not split further: a cut-off part is an error (the route turns it into the plain message)", async () => {
    const clock = { t: 0 };
    const r = reader({ ms: 1000, clock, truncateAbove: 3 });
    await expect(readProgram(program(45), deps(clock, r.fn))).rejects.toBeInstanceOf(Truncated);
  });
  it("if a part ran out of time, everything after it is dropped so there is never a hole in the middle", async () => {
    const clock = { t: 0 };
    // Every read takes 100 seconds. The first part (weeks 1-10) reads fine; the second (weeks 11-20) is cut off and, with the clock at 200 seconds, its halves cannot start.
    const r = reader({ ms: 100_000, clock, truncateIf: (text) => text.includes("Week 20") });
    const out = await readProgram(program(20), deps(clock, r.fn));
    if (out === "not_a_list") throw new Error("unexpected");
    expect(out.stoppedEarly).toBe(true);
    const weeks = out.rows.map((x) => Number(x.week.replace("Week ", "")));
    expect(weeks.length).toBeGreaterThan(0);
    expect(weeks).toEqual(Array.from({ length: weeks.length }, (_, i) => i + 1));
    expect(weeks.length).toBeLessThan(20);
  });
});

describe("the route", () => {
  it("uses the planned, parallel read and gives parts the biggest answer", () => {
    const route = read("app/api/ai/parse-workout/route.ts");
    expect(route).toContain("readProgram(plan.sourceText");
    expect(route).toContain("const PART_MAX_TOKENS = 32000;");
    expect(route).toContain("opts.big ? PART_MAX_TOKENS : READ_MAX_TOKENS");
  });
});
