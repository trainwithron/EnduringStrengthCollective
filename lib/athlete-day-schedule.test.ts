import { describe, expect, it } from "vitest";
import {
  resolveDayWorkout,
  resolveNextUnloggedWorkout,
  type ScheduledWorkoutEntry,
} from "./athlete-day-schedule";

const today = new Date("2026-09-12T00:00:00");

function scheduled(dateStr: string): ScheduledWorkoutEntry[] {
  return [{ workoutId: "w1", title: "Day 1 - Squat", date: new Date(`${dateStr}T00:00:00`) }];
}

describe("resolveDayWorkout", () => {
  it("returns no-program when nothing is scheduled at all", () => {
    expect(resolveDayWorkout([], new Set(), today, today, "day")).toEqual({
      status: "no-program",
      workoutId: null,
      title: null,
    });
  });

  it("returns rest when no workout falls on the target date", () => {
    const result = resolveDayWorkout(scheduled("2026-09-10"), new Set(), today, today, "day");
    expect(result.status).toBe("rest");
  });

  it("returns done when the scheduled workout is already logged, regardless of date", () => {
    const result = resolveDayWorkout(scheduled("2026-09-12"), new Set(["w1"]), today, today, "day");
    expect(result).toEqual({ status: "done", workoutId: "w1", title: "Day 1 - Squat" });
  });

  it("returns missed for an unlogged workout scheduled in the past", () => {
    const past = new Date("2026-09-10T00:00:00");
    const result = resolveDayWorkout(scheduled("2026-09-10"), new Set(), past, today, "day");
    expect(result.status).toBe("missed");
  });

  it("returns planned for today's own unlogged workout", () => {
    const result = resolveDayWorkout(scheduled("2026-09-12"), new Set(), today, today, "day");
    expect(result.status).toBe("planned");
  });

  it("returns locked for a future workout outside the day visibility window", () => {
    const future = new Date("2026-09-15T00:00:00");
    const result = resolveDayWorkout(scheduled("2026-09-15"), new Set(), future, today, "day");
    expect(result.status).toBe("locked");
  });

  it("returns planned for a future workout inside a week visibility window", () => {
    const future = new Date("2026-09-15T00:00:00");
    const result = resolveDayWorkout(scheduled("2026-09-15"), new Set(), future, today, "week");
    expect(result.status).toBe("planned");
  });

  it("never returns missed for today itself, even right at midnight", () => {
    const result = resolveDayWorkout(scheduled("2026-09-12"), new Set(), today, today, "day");
    expect(result.status).not.toBe("missed");
  });
});

describe("resolveNextUnloggedWorkout", () => {
  const workouts = [
    { id: "w1", title: "Day 1" },
    { id: "w2", title: "Day 2" },
    { id: "w3", title: "Day 3" },
  ];

  it("returns no-program when the program has no workouts at all", () => {
    expect(resolveNextUnloggedWorkout([], new Set())).toEqual({
      status: "no-program",
      workoutId: null,
      title: null,
    });
  });

  it("returns the first unlogged workout in order", () => {
    const result = resolveNextUnloggedWorkout(workouts, new Set(["w1"]));
    expect(result).toEqual({ status: "planned", workoutId: "w2", title: "Day 2" });
  });

  it("returns done when every workout is already logged", () => {
    const result = resolveNextUnloggedWorkout(workouts, new Set(["w1", "w2", "w3"]));
    expect(result.status).toBe("done");
  });

  it("returns the very first workout when nothing is logged yet", () => {
    const result = resolveNextUnloggedWorkout(workouts, new Set());
    expect(result).toEqual({ status: "planned", workoutId: "w1", title: "Day 1" });
  });
});
