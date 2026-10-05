import { describe, expect, it } from "vitest";
import { buildHomeThread, currentWeekStreak, describeGoal, describeProgramPosition, describeStreak } from "./home-thread";

const d = (s: string) => new Date(`${s}T12:00:00`);
const today = d("2026-10-07"); // a Wednesday

describe("describeGoal", () => {
  const base = { goalType: "muscle_gain", customLabel: null, targetDate: null, status: "confirmed" };
  it("shows only a confirmed goal", () => {
    expect(describeGoal({ ...base, status: "proposed" }, today)).toBeNull();
    expect(describeGoal({ ...base, status: "declined" }, today)).toBeNull();
    expect(describeGoal(null, today)).toBeNull();
    expect(describeGoal(base, today)).toBe("Muscle gain");
  });
  it("counts down to the target date in weeks, then days", () => {
    expect(describeGoal({ ...base, targetDate: "2026-12-30" }, today)).toBe("Muscle gain · 12 weeks to go");
    expect(describeGoal({ ...base, targetDate: "2026-10-10" }, today)).toBe("Muscle gain · 3 days to go");
    expect(describeGoal({ ...base, targetDate: "2026-10-08" }, today)).toBe("Muscle gain · 1 day to go");
    expect(describeGoal({ ...base, targetDate: "2026-10-07" }, today)).toBe("Muscle gain · goal day is today");
  });
  it("says nothing about the date once it has passed", () => {
    expect(describeGoal({ ...base, targetDate: "2026-09-01" }, today)).toBe("Muscle gain");
  });
  it("uses the client's own words for a custom goal, and nothing when there are none", () => {
    expect(describeGoal({ ...base, goalType: "custom", customLabel: " First pull-up " }, today)).toBe("First pull-up");
    expect(describeGoal({ ...base, goalType: "custom", customLabel: "  " }, today)).toBeNull();
  });
});

describe("describeProgramPosition", () => {
  const scheduled = (startDate: string, weeks: number) => {
    const out: Date[] = [];
    const start = new Date(`${startDate}T00:00:00`);
    for (let w = 0; w < weeks; w++) for (const off of [0, 2, 4]) out.push(new Date(start.getFullYear(), start.getMonth(), start.getDate() + w * 7 + off));
    return out;
  };
  const program = (startDate: string, weeks: number) => ({ name: "Strength block", unscheduled: false, startDate, scheduledDates: scheduled(startDate, weeks), totalWorkouts: 0, doneWorkouts: 0 });
  it("counts the week from the start date", () => {
    expect(describeProgramPosition(program("2026-09-28", 8), today)).toBe("Strength block: week 2 of 8");
    expect(describeProgramPosition(program("2026-10-05", 8), today)).toBe("Strength block: week 1 of 8");
  });
  it("says when it has not started and when it is over", () => {
    expect(describeProgramPosition(program("2026-10-12", 4), today)).toBe("Strength block: starts Oct 12");
    expect(describeProgramPosition(program("2026-08-03", 4), today)).toBe("Strength block: finished");
  });
  it("counts workouts for a program with no dates", () => {
    const p = { name: "Playlist", unscheduled: true, startDate: null, scheduledDates: [], totalWorkouts: 12, doneWorkouts: 4 };
    expect(describeProgramPosition(p, today)).toBe("Playlist: workout 5 of 12");
    expect(describeProgramPosition({ ...p, doneWorkouts: 12 }, today)).toBe("Playlist: finished");
    expect(describeProgramPosition({ ...p, totalWorkouts: 0 }, today)).toBeNull();
  });
  it("says nothing without a program", () => {
    expect(describeProgramPosition(null, today)).toBeNull();
  });
});

describe("currentWeekStreak", () => {
  it("counts consecutive weeks including this one", () => {
    expect(currentWeekStreak([d("2026-10-06"), d("2026-09-29"), d("2026-09-22")], today)).toBe(3);
  });
  it("keeps the run alive on a Monday before this week's first workout", () => {
    expect(currentWeekStreak([d("2026-09-30"), d("2026-09-24"), d("2026-09-17")], d("2026-10-05"))).toBe(3);
  });
  it("is broken by a missed week", () => {
    expect(currentWeekStreak([d("2026-10-06"), d("2026-09-22")], today)).toBe(1);
  });
  it("is zero with nothing in this or last week", () => {
    expect(currentWeekStreak([d("2026-09-01")], today)).toBe(0);
    expect(currentWeekStreak([], today)).toBe(0);
  });
});

describe("describeStreak / buildHomeThread", () => {
  it("a streak starts at two weeks", () => {
    expect(describeStreak(1)).toBeNull();
    expect(describeStreak(4)).toBe("4-week streak");
  });
  it("lists only what is true, in order", () => {
    expect(buildHomeThread({ goal: null, program: null, logDates: [], today })).toEqual([]);
    const lines = buildHomeThread({
      goal: { goalType: "weight_loss", customLabel: null, targetDate: null, status: "confirmed" },
      program: null,
      logDates: [d("2026-10-06"), d("2026-09-29")],
      today,
    });
    expect(lines).toEqual(["Weight loss", "2-week streak"]);
  });
});
