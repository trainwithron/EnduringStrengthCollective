import { describe, it, expect } from "vitest";
import { programCardStats } from "./program-card-stats";

const workouts = [{ id: "a", week_number: 1 }, { id: "b", week_number: 1 }, { id: "c", week_number: 4 }];

describe("a program's card numbers", () => {
  it("counts each workout once and finds the latest", () => {
    const logs = [{ workout_id: "a", created_at: "2026-11-01T18:00:00Z" }, { workout_id: "a", created_at: "2026-11-05T18:00:00Z" }, { workout_id: "z", created_at: "2026-11-08T18:00:00Z" }];
    expect(programCardStats(workouts, logs, "UTC")).toEqual([
      { value: "4", label: "Weeks" },
      { value: "1 of 3", label: "Workouts done" },
      { value: "11/5", label: "Last workout" },
    ]);
  });
  it("leaves out what is not there", () => {
    expect(programCardStats([], [], "UTC")).toEqual([]);
    expect(programCardStats(workouts, [], "UTC").map((s) => s.label)).toEqual(["Weeks", "Workouts done"]);
  });
});
