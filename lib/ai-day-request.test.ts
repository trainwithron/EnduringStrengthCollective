import { describe, it, expect } from "vitest";
import { fixTargetFrom, parseBuildRequest, planSlots } from "@/lib/ai-day-request";
import { checkRunToken, daysPerWeekOf, issueRunToken, nextSlotToBuild, readDayResult, RUN_TTL_MS, MAX_DAYS_PER_RUN } from "@/lib/ai-day-run";

describe("Reading the request", () => {
  it("weeks, days a week and finish the week", () => {
    expect(parseBuildRequest("make it 4 weeks")).toEqual({ weeks: 4, daysPerWeek: null, finishWeek: false });
    expect(parseBuildRequest("a 6-week block, 3 days a week")).toEqual({ weeks: 6, daysPerWeek: 3, finishWeek: false });
    expect(parseBuildRequest("finish the week using this")).toMatchObject({ finishWeek: true, weeks: null });
    expect(parseBuildRequest("four weeks of three days per week")).toMatchObject({ weeks: 4, daysPerWeek: 3 });
    expect(parseBuildRequest("3x a week for a month")).toMatchObject({ weeks: 4, daysPerWeek: 3 });
    expect(parseBuildRequest("upper body heavy")).toEqual({ weeks: null, daysPerWeek: null, finishWeek: false });
  });
  it("does not read '3 days a week' as three weeks", () => {
    expect(parseBuildRequest("3 days a week").weeks).toBeNull();
  });
});

describe("Which days get built", () => {
  const day = (week: number, d: number, hasExercises: boolean) => ({ week, day: d, hasExercises });
  it("finish the week fills only the empty days of the week under way, using the program's training days", () => {
    expect(planSlots([day(1, 1, true)], parseBuildRequest("finish the week using Day 1"), 3)).toEqual([{ week: 1, day: 2 }, { week: 1, day: 3 }]);
  });
  it("make it 4 weeks fills every empty day of 4 weeks and never a day that has exercises", () => {
    const slots = planSlots([day(1, 1, true), day(1, 2, true), day(1, 3, true)], parseBuildRequest("make it 4 weeks"), 3);
    expect(slots).toHaveLength(9);
    expect(slots[0]).toEqual({ week: 2, day: 1 });
    expect(slots.some((s) => s.week === 1)).toBe(false);
  });
  it("an empty program with no numbers builds 4 weeks of 3 days", () => {
    expect(planSlots([], parseBuildRequest("full body program"), null)).toHaveLength(12);
  });
  it("one run builds at most the number of days a run is charged for", () => {
    expect(planSlots([], parseBuildRequest("12 weeks, 5 days a week"), null)).toHaveLength(MAX_DAYS_PER_RUN);
  });
  it("an empty day that exists is filled, not skipped", () => {
    expect(planSlots([day(1, 1, true), day(1, 2, false)], parseBuildRequest("finish the week"), 2)).toEqual([{ week: 1, day: 2 }]);
  });
});

describe("Corrections point at a day", () => {
  it("week and day, day alone, or nothing (the last built day)", () => {
    expect(fixTargetFrom("no barbell squats on week 2 day 3")).toEqual({ week: 2, day: 3 });
    expect(fixTargetFrom("swap the squat in day 2")).toEqual({ week: null, day: 2 });
    expect(fixTargetFrom("no barbell squats, his back")).toBeNull();
  });
});

describe("The run token", () => {
  const now = 1_800_000_000_000;
  it("is good for the same person and program, for two hours, and only until the day cap", () => {
    const t = issueRunToken("u1", "p1", 3, now);
    expect(checkRunToken(t, "u1", "p1", now + 1000)).toEqual({ ok: true, days: 3, issuedAt: now });
    expect(checkRunToken(t, "u2", "p1", now + 1000).ok).toBe(false);
    expect(checkRunToken(t, "u1", "p2", now + 1000).ok).toBe(false);
    expect(checkRunToken(t, "u1", "p1", now + RUN_TTL_MS + 1).ok).toBe(false);
    expect(checkRunToken(issueRunToken("u1", "p1", MAX_DAYS_PER_RUN, now), "u1", "p1", now).ok).toBe(false);
  });
  it("a forged or damaged token is refused", () => {
    const t = issueRunToken("u1", "p1", 1, now);
    expect(checkRunToken(t.slice(0, -2) + "xx", "u1", "p1", now).ok).toBe(false);
    expect(checkRunToken("nonsense", "u1", "p1", now).ok).toBe(false);
    expect(checkRunToken(null, "u1", "p1", now).ok).toBe(false);
  });
});

describe("Reading a day from the AI", () => {
  it("keeps a usable day and refuses an empty or malformed one", () => {
    const ok = readDayResult({ title: "Lower", exercises: [{ exerciseName: "Back Squat", sets: 3, reps: "5", weight: null, rpe: 8, rest: "2:00", timeSeconds: null }] }, "Day 2");
    expect(ok?.title).toBe("Lower");
    expect(ok?.exercises[0]).toMatchObject({ exerciseName: "Back Squat", sets: 3, reps: "5", rpe: 8 });
    expect(readDayResult({ exercises: [] }, "Day 2")).toBeNull();
    expect(readDayResult({ exercises: [{ exerciseName: "", sets: 3 }] }, "Day 2")).toBeNull();
    expect(readDayResult({ exercises: [{ exerciseName: "Squat", sets: 0 }] }, "Day 2")).toBeNull();
    expect(readDayResult({ exercises: [{ exerciseName: "Squat", sets: 3 }] }, "Day 2")?.title).toBe("Day 2");
  });
  it("finds the next empty day", () => {
    expect(nextSlotToBuild([{ week: 1, day: 1, hasExercises: true }, { week: 1, day: 2, hasExercises: false }], 3)).toEqual({ week: 1, day: 2 });
    expect(nextSlotToBuild([{ week: 1, day: 3, hasExercises: true }], 3)).toEqual({ week: 2, day: 1 });
    expect(daysPerWeekOf([{ week: 1, day: 3 }, { week: 2, day: 3 }, { week: 3, day: 2 }])).toBe(3);
  });
});
