import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { partialMessage, readInParts, weeksIn, type PartsDeps } from "@/lib/read-in-parts";
import type { ParsedImportRow } from "@/lib/workout-import-parser";

const read = (rel: string) => readFileSync(join(__dirname, "..", rel), "utf8").replace(/\r\n/g, "\n");

class Truncated extends Error {}

// A big program as plain text: 12 weeks x 4 days x 5 exercises.
const weeksText = (n: number) =>
  Array.from({ length: n }, (_, w) => `Week ${w + 1}\n` + Array.from({ length: 4 }, (_, d) => `Day ${d + 1}\n` + Array.from({ length: 5 }, (_, e) => `Exercise ${e + 1} ${3 + e}x${8 + d} @ RPE ${6 + (w % 4)}`).join("\n")).join("\n")).join("\n\n");

// A pretend reader: it turns every "Week n ... Day ... Exercise" line group into rows, but "runs out of room" (truncates) when given more than `maxWeeks` weeks. Each read costs `ms`.
function fakeReader(clock: { t: number }, maxWeeks: number, ms: number) {
  const calls: string[] = [];
  const reader: PartsDeps["read"] = async (text) => {
    calls.push(text);
    clock.t += ms;
    const weeks = text.split(/\n\n/).filter((b) => /^Week \d+/.test(b.trim()));
    if (weeks.length > maxWeeks) throw new Truncated();
    const rows: ParsedImportRow[] = [];
    for (const block of weeks) {
      const week = block.match(/^Week \d+/)![0];
      let day = "Day 1";
      for (const line of block.split("\n")) {
        if (/^Day \d+/.test(line)) day = line.trim();
        else if (/^Exercise/.test(line)) rows.push({ week, day, exerciseName: line.split(" ").slice(0, 2).join(" "), sets: 3, reps: "8", weight: null, rpe: null, rest: null, timeSeconds: null });
      }
    }
    return rows;
  };
  return { reader, calls };
}

const deps = (clock: { t: number }, reader: PartsDeps["read"], deadline = 240_000): PartsDeps => ({
  read: reader,
  isTruncated: (e) => e instanceof Truncated,
  now: () => clock.t,
  deadlineAt: deadline,
  defaultReadMs: 60_000,
  maxDepth: 2,
});

describe("a large program (12 weeks x 4 days) through the splitter", () => {
  const text = weeksText(12);
  it("fits in one read when the reader has room: one part, every row", async () => {
    const clock = { t: 0 };
    const { reader, calls } = fakeReader(clock, 12, 1000);
    const out = await readInParts(text, deps(clock, reader));
    expect(out).not.toBe("not_a_list");
    if (out === "not_a_list") return;
    expect(calls).toHaveLength(1);
    expect(out.parts).toBe(1);
    expect(out.rows).toHaveLength(12 * 4 * 5);
    expect(out.stoppedEarly).toBe(false);
  });
  it("when one read is too much, the halves are read in order and every row comes back exactly once", async () => {
    const clock = { t: 0 };
    const { reader, calls } = fakeReader(clock, 6, 1000);
    const out = await readInParts(text, deps(clock, reader));
    if (out === "not_a_list") throw new Error("unexpected");
    expect(calls).toHaveLength(3); // the whole (cut off), then each half
    expect(out.parts).toBe(2);
    expect(out.rows).toHaveLength(12 * 4 * 5);
    expect(weeksIn(out.rows)).toBe(12);
    expect(out.rows[0].week).toBe("Week 1");
    expect(out.rows[out.rows.length - 1].week).toBe("Week 12");
    expect(out.stoppedEarly).toBe(false);
  });
  it("a quarter-size reader needs four parts and still gets everything", async () => {
    const clock = { t: 0 };
    const { reader } = fakeReader(clock, 3, 1000);
    const out = await readInParts(text, deps(clock, reader));
    if (out === "not_a_list") throw new Error("unexpected");
    expect(out.parts).toBe(4);
    expect(out.rows).toHaveLength(12 * 4 * 5);
  });
});

describe("a slow reader never runs past the deadline", () => {
  const text = weeksText(12);
  it("stops starting reads when the next one would not finish, and hands back what it has, in order", async () => {
    const clock = { t: 0 };
    const { reader, calls } = fakeReader(clock, 6, 100_000); // every read takes 100 seconds
    const out = await readInParts(text, deps(clock, reader, 240_000));
    if (out === "not_a_list") throw new Error("unexpected");
    // The whole program (cut off) took 100s, the first half 100s: at 200s another 100s read would end past 240s, so the second half is not started.
    expect(calls).toHaveLength(2);
    expect(out.stoppedEarly).toBe(true);
    expect(out.parts).toBe(1);
    expect(weeksIn(out.rows)).toBe(6);
    expect(out.rows[0].week).toBe("Week 1");
    expect(partialMessage(out.rows)).toBe("Read the first 6 weeks; the rest was too large to finish. Try the remaining weeks separately.");
    expect(clock.t).toBeLessThanOrEqual(240_000);
  });
  it("the first read always runs, even if the clock is already late", async () => {
    const clock = { t: 500_000 };
    const { reader, calls } = fakeReader(clock, 12, 1000);
    const out = await readInParts(text, deps(clock, reader, 240_000));
    if (out === "not_a_list") throw new Error("unexpected");
    expect(calls).toHaveLength(1);
    expect(out.rows.length).toBeGreaterThan(0);
  });
  it("a reader that is not giving a list is reported, not guessed at", async () => {
    const clock = { t: 0 };
    const out = await readInParts(text, deps(clock, async () => "not_a_list"));
    expect(out).toBe("not_a_list");
  });
  it("an error that is not a cut-off is passed on", async () => {
    const clock = { t: 0 };
    await expect(readInParts(text, deps(clock, async () => { throw new Error("boom"); }))).rejects.toThrow("boom");
  });
});

describe("how the route uses it", () => {
  const route = read("app/api/ai/parse-workout/route.ts");
  it("gets the Pro plan's 300 seconds, stops starting reads at 240, and reports what it read", () => {
    expect(route).toContain("export const maxDuration = 300;");
    expect(route).toContain("const READ_BUDGET_MS = 240_000;");
    expect(route).toContain("deadlineAt: startedAt + READ_BUDGET_MS");
    expect(route).toContain("if (read.stoppedEarly && rows.length > 0) note = partialMessage(rows);");
    expect(route).toContain("return NextResponse.json({ rows, parts, note });");
  });
  it("the review screen shows that note at the top of the red list", () => {
    const wizard = read("components/coach/desktop/import-wizard.tsx");
    expect(wizard).toContain("readNote: typeof data.note === \"string\" && data.note ? data.note : undefined,");
    expect(wizard).toContain("...(extras.readNote ? [extras.readNote] : [])");
  });
});
