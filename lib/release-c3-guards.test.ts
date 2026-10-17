import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { applyContractGuards, consecutiveMisses, sessionMissed, daysBetween, RESET_AFTER_MISSES } from "@/lib/progression-guards";

const src = (p: string) => readFileSync(join(__dirname, "..", p), "utf8").replace(/\r\n/g, "\n");
const sess = (...reps: number[]) => ({ sets: reps.map((r) => ({ weight: 200, reps: r })) });
const rule = { weight: 205, reps: 8, reason: "rule says up" };

describe("a break lowers the number", () => {
  it("under 14 days: untouched; 14-27: 95 percent; 28-55: 90 percent, rounded down; 56 or more: no number, ask the coach", () => {
    const base = { target: rule, previousWeight: 200, missStreak: 0, protectedAge: false };
    expect(applyContractGuards({ ...base, daysSince: 5 }).weight).toBe(205);
    expect(applyContractGuards({ ...base, daysSince: 20 })).toMatchObject({ weight: 190, status: "suggest" }); // 200 x 0.95
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
    const base = { target: rule, previousWeight: 200, daysSince: 3, protectedAge: false };
    expect(applyContractGuards({ ...base, missStreak: 1 })).toMatchObject({ weight: 200, status: "hold" });
    expect(applyContractGuards({ ...base, missStreak: 2 })).toMatchObject({ weight: 200, status: "hold" });
    expect(RESET_AFTER_MISSES).toBe(3);
    const reset = applyContractGuards({ ...base, missStreak: 3 });
    expect(reset).toMatchObject({ weight: 180, status: "reset" });
    expect(reset.reason).toContain("3 times in a row");
    expect(applyContractGuards({ ...base, missStreak: 0 }).weight).toBe(205);
  });
});

describe("under 18 or an unknown age", () => {
  it("a goal never jumps more than 5 lb above last time", () => {
    const jump = { weight: 215, reps: 8, reason: "rule says up" };
    const out = applyContractGuards({ target: jump, previousWeight: 200, daysSince: 3, missStreak: 0, protectedAge: true });
    expect(out.weight).toBe(205);
    expect(out.reason).toContain("5 lb step up for your age");
    expect(applyContractGuards({ target: jump, previousWeight: 200, daysSince: 3, missStreak: 0, protectedAge: false }).weight).toBe(215);
    expect(applyContractGuards({ target: { weight: 205, reps: 8 }, previousWeight: 200, daysSince: 3, missStreak: 0, protectedAge: true }).weight).toBe(205);
  });
  it("no previous lift means nothing to guard", () => {
    expect(applyContractGuards({ target: rule, previousWeight: null, daysSince: 100, missStreak: 5, protectedAge: true })).toEqual(rule);
  });
});

describe("wired into the goal loader", () => {
  it("the loader reads the last sessions' dates and sets, the age, and applies the guards before a goal is shown", () => {
    const p = src("lib/progressions.ts");
    expect(p).toContain("applyContractGuards({");
    expect(p).toContain("consecutiveMisses(recent, (r.config as DoubleProgressionConfig).repRangeLow)");
    expect(p).toContain('(await athleteAgeStatus(supabase, athleteId)) !== "adult"');
    expect(p).toContain("target.status === \"ask_coach\"");
    expect(src("components/logging/pre-start-exercise-row.tsx")).toContain("goal?.reason");
  });
});
