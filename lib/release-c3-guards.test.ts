import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { applyContractGuards, consecutiveMisses, sessionMissed, daysBetween, usualGapDays, RESET_AFTER_MISSES } from "@/lib/progression-guards";

const src = (p: string) => readFileSync(join(__dirname, "..", p), "utf8").replace(/\r\n/g, "\n");
const sess = (...reps: number[]) => ({ sets: reps.map((r) => ({ weight: 200, reps: r })) });
const rule = { weight: 205, reps: 8, reason: "rule says up" };

describe("a break lowers the number", () => {
  it("under 21 days: untouched; 21-34: 95 percent; 35-55: 90 percent, rounded down; 56 or more: no number, ask the coach", () => {
    const base = { target: rule, previousWeight: 200, missStreak: 0 };
    expect(applyContractGuards({ ...base, daysSince: 5 }).weight).toBe(205);
    expect(applyContractGuards({ ...base, daysSince: 20 }).weight).toBe(205); // two weeks and a bit: still normal
    expect(applyContractGuards({ ...base, daysSince: 25 })).toMatchObject({ weight: 190, status: "suggest" }); // 200 x 0.95
    expect(applyContractGuards({ ...base, daysSince: 40 })).toMatchObject({ weight: 180, status: "suggest" }); // 200 x 0.90
    const ask = applyContractGuards({ ...base, daysSince: 60 });
    expect(ask).toMatchObject({ weight: null, reps: null, status: "ask_coach" });
    expect(ask.reason).toContain("8 weeks");
    expect(applyContractGuards({ ...base, daysSince: null }).weight).toBe(205);
  });
  it("counts whole days", () => {
    expect(daysBetween("2026-10-01T00:00:00Z", new Date("2026-10-21T12:00:00Z"))).toBe(20);
    expect(daysBetween(null, new Date())).toBeNull();
  });
});

describe("an exercise a program schedules every other week is not a break each time", () => {
  it("a gap close to the usual gap is normal; clearly longer than usual is a break", () => {
    const base = { target: rule, previousWeight: 200, missStreak: 0 };
    expect(applyContractGuards({ ...base, daysSince: 14, normalGapDays: 14 }).weight).toBe(205);
    expect(applyContractGuards({ ...base, daysSince: 20, normalGapDays: 14 }).weight).toBe(205); // within a week of the usual gap
    expect(applyContractGuards({ ...base, daysSince: 28, normalGapDays: 28 }).weight).toBe(205);
    expect(applyContractGuards({ ...base, daysSince: 40, normalGapDays: 14 })).toMatchObject({ weight: 180, status: "suggest" });
    expect(applyContractGuards({ ...base, daysSince: 25, normalGapDays: null }).weight).toBe(190);
    expect(applyContractGuards({ ...base, daysSince: 25, normalGapDays: 21 }).weight).toBe(205);
  });
});

describe("the miss ladder: hold, hold, then reset 10 percent on the third miss", () => {
  it("counts misses in a row at the same weight, newest first, and stops at a success or another weight", () => {
    expect(sessionMissed(sess(8, 8, 6), 8)).toBe(true);
    expect(sessionMissed(sess(8, 8, 8), 8)).toBe(false);
    expect(consecutiveMisses([sess(6), sess(7), sess(5)], 8)).toBe(3);
    expect(consecutiveMisses([sess(6), sess(8, 8), sess(5)], 8)).toBe(1);
    expect(consecutiveMisses([sess(8, 8), sess(5)], 8)).toBe(0);
    expect(consecutiveMisses([sess(6), { sets: [{ weight: 190, reps: 5 }] }], 8)).toBe(1);
    expect(consecutiveMisses([], 8)).toBe(0);
  });
  it("1st and 2nd miss hold the weight; the 3rd resets to 90 percent rounded down; a success clears it", () => {
    const base = { target: rule, previousWeight: 200, daysSince: 3 };
    expect(applyContractGuards({ ...base, missStreak: 1 })).toMatchObject({ weight: 200, status: "hold" });
    expect(applyContractGuards({ ...base, missStreak: 2 })).toMatchObject({ weight: 200, status: "hold" });
    expect(RESET_AFTER_MISSES).toBe(3);
    const reset = applyContractGuards({ ...base, missStreak: 3 });
    expect(reset).toMatchObject({ weight: 180, status: "reset" });
    expect(reset.reason).toContain("3 times in a row");
    expect(applyContractGuards({ ...base, missStreak: 0 }).weight).toBe(205);
  });
});

describe("age makes no difference to a step up", () => {
  it("a goal is the coach's step, whoever the athlete is: no cap by age", () => {
    const jump = { weight: 215, reps: 8, reason: "rule says up" };
    const out = applyContractGuards({ target: jump, previousWeight: 200, daysSince: 3, missStreak: 0 });
    expect(out.weight).toBe(215);
    expect(out.reason).toBe("rule says up");
  });
  it("the guard no longer knows an athlete's age at all", () => {
    const guards = readFileSync(join(__dirname, "progression-guards.ts"), "utf8");
    const progressions = readFileSync(join(__dirname, "progressions.ts"), "utf8");
    expect(guards).not.toContain("protectedAge");
    expect(guards).not.toContain("MINOR_MAX_JUMP_LBS");
    expect(progressions).not.toContain("isAgeProtected");
    expect(progressions).not.toContain("protectedAge");
    expect(progressions).not.toContain("effectiveAgeStatus");
  });
  it("no previous lift means nothing to guard", () => {
    expect(applyContractGuards({ target: rule, previousWeight: null, daysSince: 100, missStreak: 5 })).toEqual(rule);
  });
});

describe("wired into the goal loader", () => {
  it("the loader reads the last sessions' dates and sets and applies the guards before a goal is shown", () => {
    const p = src("lib/progressions.ts");
    expect(p).toContain("applyContractGuards({");
    expect(p).toContain("consecutiveMisses(recent, (r.config as DoubleProgressionConfig).repRangeLow)");
    expect(p).toContain("normalGapDays,");
    expect(p).toContain("target.status === \"ask_coach\"");
    expect(src("components/logging/pre-start-exercise-row.tsx")).toContain("goal?.reason");
  });
});

describe("review fixes for Release C3", () => {
  it("nobody is capped by age or by a missing birthday: the loader does not look at age at all", () => {
    const p = src("lib/progressions.ts");
    expect(p).not.toContain("isCoachSomewhere");
    expect(p).not.toContain("athleteAgeStatus");
  });
  it("the safety rules never raise a number above what the rule itself prescribed", () => {
    // a wave week that deliberately prescribes 100 after 200 last time: a 25-day break must not push it up to 190
    const light = applyContractGuards({ target: { weight: 100, reps: 5, reason: "light week" }, previousWeight: 200, daysSince: 25, missStreak: 0 });
    expect(light.weight).toBe(100);
    expect(light.reason).toBe("light week");
    // the usual case still comes down
    const normal = applyContractGuards({ target: { weight: 205, reps: 5, reason: "up" }, previousWeight: 200, daysSince: 25, missStreak: 0 });
    expect(normal.weight).toBe(190);
    // a miss hold or a reset also never goes above the rule's number
    expect(applyContractGuards({ target: { weight: 150, reps: 5 }, previousWeight: 200, daysSince: 3, missStreak: 1 }).weight).toBe(150);
    expect(applyContractGuards({ target: { weight: 150, reps: 5 }, previousWeight: 200, daysSince: 3, missStreak: 3 }).weight).toBe(150);
  });
  it("the usual gap is the middle of several gaps; one earlier break does not set it; it never silences the ask-the-coach rule", () => {
    // sessions a week apart, with one 60-day layoff in the middle: the rhythm is still about a week
    expect(usualGapDays([7, 60, 7, 8])).toBe(7);
    // a layoff that repeats is the rhythm (an exercise done every fourth week), capped below the 90 percent line
    expect(usualGapDays([28, 28])).toBe(28);
    expect(usualGapDays([60, 70])).toBe(34);
    // one long gap alone says nothing
    expect(usualGapDays([60])).toBeNull();
    expect(usualGapDays([])).toBeNull();
    // 66 days after the last session, with a usual gap of 60 taken from one layoff, used to read as normal. It does not now.
    const ask = applyContractGuards({ target: { weight: 205, reps: 5 }, previousWeight: 200, daysSince: 66, normalGapDays: usualGapDays([60]), missStreak: 0 });
    expect(ask.status).toBe("ask_coach");
    // and a 70-day gap is ask-the-coach even when the usual rhythm is long
    expect(applyContractGuards({ target: { weight: 205, reps: 5 }, previousWeight: 200, daysSince: 70, normalGapDays: 34, missStreak: 0 }).status).toBe("ask_coach");
  });
  it("GZCLP T1 and waves from a training max go through the same safety rules", () => {
    const p = src("lib/progressions.ts");
    expect(p).toContain("await guardedFromHistory(r.performanceName, { weight: target.weight, reps: target.reps, reason: target.reason })");
    expect(p).toContain("await guardedFromHistory(r.performanceName, target)");
  });
});
