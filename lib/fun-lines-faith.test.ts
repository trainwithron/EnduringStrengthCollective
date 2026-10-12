import { describe, it, expect } from "vitest";
import { FAITH_LINES, GYM_JOKES } from "@/lib/gym-jokes";
import { funLinePool, MAX_FUN_LINE_CHARS, pickSeededFunLine, type WorkoutFacts } from "@/lib/workout-fun-line";

const facts: WorkoutFacts = { totalVolume: 12000, durationSeconds: 3000, totalSets: 20, weekStreak: 3, prCount: 1, totalWorkoutCount: 40 };

describe("the approved fun lines", () => {
  it("the three new jokes are in the bank, and every line fits the card", () => {
    expect(GYM_JOKES).toContain("What goes down hopefully goes back up. Just stand up.");
    expect(GYM_JOKES).toContain("Foam roller? More like a human rolling pin.");
    expect(GYM_JOKES.some((j) => j.startsWith("Why do lifters make great friends?"))).toBe(true);
    for (const l of [...GYM_JOKES, ...FAITH_LINES]) expect(l.length, l).toBeLessThanOrEqual(MAX_FUN_LINE_CHARS);
  });
  it("the six King James lines each carry their reference", () => {
    expect(FAITH_LINES).toHaveLength(6);
    for (const l of FAITH_LINES) expect(l).toMatch(/\([1-3]? ?[A-Z][a-z]+ \d+:\d+\)$/);
  });
});

describe("the faith setting decides whether a verse can appear", () => {
  it("on (the default): the verses are in the pool", () => {
    const pool = funLinePool(facts).map((l) => l.text);
    for (const l of FAITH_LINES) expect(pool).toContain(l);
    expect(funLinePool(facts, { faith: true }).map((l) => l.text)).toContain(FAITH_LINES[0]);
  });
  it("off: no verse can be picked, however many cards are made (including the public default)", () => {
    const pool = funLinePool(facts, { faith: false }).map((l) => l.text);
    for (const l of FAITH_LINES) expect(pool).not.toContain(l);
    for (let i = 0; i < 300; i++) expect(FAITH_LINES).not.toContain(pickSeededFunLine(facts, `post-${i}`, { faith: false }).text);
  });
});
