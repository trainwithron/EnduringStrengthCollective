import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describeProgramPosition, type ThreadProgram } from "./home-thread";

// Oct 20 (Ron's own Home, christmas_abs_program): the header said "Main: week 10 of 14" (from the calendar dates) while the program row said "Week 4, Day 4 · 21 of 84 done"
// (where he left off). Ron's rule is pick up where you left off, so the header says the same week.
const weekly = (startKey: string, weeks: number) => Array.from({ length: weeks * 6 }, (_, i) => new Date(new Date(`${startKey}T00:00:00`).getTime() + Math.floor(i / 6) * 7 * 86400000 + (i % 6) * 86400000));
const base: ThreadProgram = { name: "Main", unscheduled: false, startDate: "2026-08-10", scheduledDates: weekly("2026-08-10", 14), totalWorkouts: 84, doneWorkouts: 21 };
const today = new Date("2026-10-20T12:00:00");

describe("Home's 'Main: week X of Y' follows where they pick up", () => {
  it("week 4 of 14 when the pickup is Week 4 (the calendar alone would say week 11)", () => {
    expect(describeProgramPosition(base, today)).toBe("Main: week 11 of 14");
    expect(describeProgramPosition({ ...base, pickup: { week: 4, totalWeeks: 14, complete: false } }, today)).toBe("Main: week 4 of 14");
  });
  it("finished when the pickup says the program is complete; a future start still says when it starts", () => {
    expect(describeProgramPosition({ ...base, pickup: { week: 14, totalWeeks: 14, complete: true } }, today)).toBe("Main: finished");
    const future = { ...base, startDate: "2026-11-02", scheduledDates: weekly("2026-11-02", 14) };
    expect(describeProgramPosition({ ...future, pickup: { week: 1, totalWeeks: 14, complete: false } }, today)).toBe("Main: starts Nov 2");
    // already training ahead of the start date: the pickup wins
    expect(describeProgramPosition({ ...future, pickup: { week: 2, totalWeeks: 14, complete: false } }, today)).toBe("Main: week 2 of 14");
  });
  it("Home hands it the same pickup the program row uses", () => {
    const page = readFileSync(join(__dirname, "..", "app", "(coach)", "groups", "[groupId]", "page.tsx"), "utf8").replace(/\r\n/g, "\n");
    expect(page).toContain("pickup: threadPickup(main.program.id),");
    expect(page).toContain("const pick = programWorkoutRead.error || programDoneRead.failed ? undefined : homePickups.get(programId);");
  });
});
