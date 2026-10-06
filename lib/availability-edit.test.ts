import { describe, it, expect } from "vitest";
import { copyTargets, timeToMinutes, validateWindow, windowsOverlap } from "./availability-edit";

const win = (id: string, weekday: number, startTime: string, endTime: string) => ({ id, weekday, startTime, endTime });

describe("validateWindow", () => {
  const others = [win("a", 1, "06:00:00", "12:00:00"), win("b", 2, "06:00", "17:00")];
  it("accepts a normal window and reads HH:MM:SS the same as HH:MM", () => {
    expect(validateWindow({ weekday: 3, startTime: "06:00", endTime: "17:00", slotMinutes: 60 }, others)).toBeNull();
    expect(timeToMinutes("06:30:00")).toBe(390);
  });
  it("needs an end after the start and a sensible session length", () => {
    expect(validateWindow({ weekday: 3, startTime: "17:00", endTime: "06:00", slotMinutes: 60 }, others)).toMatch(/End time/);
    expect(validateWindow({ weekday: 3, startTime: "06:00", endTime: "07:00", slotMinutes: 2 }, others)).toMatch(/whole number/);
    expect(validateWindow({ weekday: 3, startTime: "06:00", endTime: "07:00", slotMinutes: 90 }, others)).toMatch(/longer than the whole window/);
  });
  it("refuses an overlap on the same day, lets windows touch, and lets a window be edited over itself", () => {
    expect(validateWindow({ weekday: 1, startTime: "11:00", endTime: "14:00", slotMinutes: 60 }, others)).toMatch(/overlaps/);
    expect(validateWindow({ weekday: 1, startTime: "12:00", endTime: "17:00", slotMinutes: 60 }, others)).toBeNull();
    expect(validateWindow({ weekday: 1, startTime: "07:00", endTime: "13:00", slotMinutes: 60 }, others, "a")).toBeNull();
    expect(validateWindow({ weekday: 4, startTime: "11:00", endTime: "14:00", slotMinutes: 60 }, others)).toBeNull();
  });
});

describe("windowsOverlap", () => {
  it("is false for different days and for windows that only touch", () => {
    expect(windowsOverlap(win("x", 1, "06:00", "12:00"), win("y", 2, "06:00", "12:00"))).toBe(false);
    expect(windowsOverlap(win("x", 1, "06:00", "12:00"), win("y", 1, "12:00", "17:00"))).toBe(false);
    expect(windowsOverlap(win("x", 1, "06:00", "12:00"), win("y", 1, "11:59", "17:00"))).toBe(true);
  });
});

describe("copyTargets", () => {
  const existing = [win("a", 1, "06:00", "17:00"), win("b", 2, "08:00", "09:00")];
  it("copies to the chosen days, skips a day that already has overlapping hours, and never copies onto the source day", () => {
    const r = copyTargets({ weekday: 1, startTime: "06:00", endTime: "17:00" }, [1, 2, 3, 3, 4], existing);
    expect(r).toEqual({ create: [3, 4], skipped: [2] });
  });
  it("copies to every day when nothing is in the way", () => {
    expect(copyTargets({ weekday: 1, startTime: "06:00", endTime: "17:00" }, [2, 3], [])).toEqual({ create: [2, 3], skipped: [] });
  });
});
