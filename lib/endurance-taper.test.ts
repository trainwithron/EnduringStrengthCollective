import { describe, it, expect } from "vitest";
import { computeEnduranceTaperSchedule, currentTaperMultiplier } from "./endurance-taper";

describe("computeEnduranceTaperSchedule", () => {
  it("decays monotonically down to the recreational race-week floor over 3 weeks", () => {
    const schedule = computeEnduranceTaperSchedule(3, "recreational");
    expect(schedule).toEqual([
      { weeksBeforeEvent: 2, volumeMultiplier: 1 },
      { weeksBeforeEvent: 1, volumeMultiplier: 0.75 },
      { weeksBeforeEvent: 0, volumeMultiplier: 0.5 },
    ]);
  });

  it("goes straight to the floor for a single race week", () => {
    expect(computeEnduranceTaperSchedule(1, "recreational")).toEqual([
      { weeksBeforeEvent: 0, volumeMultiplier: 0.5 },
    ]);
  });

  it("uses a shallower cut for the elite profile", () => {
    const schedule = computeEnduranceTaperSchedule(1, "elite");
    expect(schedule[0].volumeMultiplier).toBe(0.7);
  });

  it("never touches intensity — only ever returns a volume multiplier", () => {
    const schedule = computeEnduranceTaperSchedule(2);
    expect(schedule.every((w) => "volumeMultiplier" in w && !("intensity" in w))).toBe(true);
  });

  it("returns an empty schedule for zero or negative taper weeks", () => {
    expect(computeEnduranceTaperSchedule(0)).toEqual([]);
  });
});

describe("currentTaperMultiplier", () => {
  it("returns full volume before the taper window starts", () => {
    expect(currentTaperMultiplier(5, 2)).toBe(1);
  });

  it("returns the correct scheduled multiplier inside the taper window", () => {
    expect(currentTaperMultiplier(1, 3, "recreational")).toBe(0.75);
  });

  it("clamps to the race-week floor once the event has passed", () => {
    expect(currentTaperMultiplier(-1, 2, "recreational")).toBe(0.5);
  });
});
