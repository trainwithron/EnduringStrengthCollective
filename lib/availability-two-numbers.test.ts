import { describe, it, expect } from "vitest";
import { currentTiming, sessionCount, stepFor, timingProblem } from "./availability-edit";

// Ron, Oct 31: 55-minute sessions with a 5-minute gap drifted 5 minutes through the day. The hours now take two numbers and starts follow from them.
describe("two numbers: session length and gap", () => {
  it("a start is offered every session + gap minutes", () => {
    expect(stepFor(55, 5)).toBe(60);
    expect(stepFor(60, 0)).toBe(60);
  });
  it("counts the sessions that fit in a window", () => {
    expect(sessionCount({ startTime: "08:00", endTime: "12:00" }, 55, 5)).toBe(4);
    expect(sessionCount({ startTime: "06:00", endTime: "17:00" }, 60, 0)).toBe(11);
    expect(sessionCount({ startTime: "08:00", endTime: "08:30" }, 55, 5)).toBe(0);
  });
  it("reads the coach's current numbers, and flags hours whose start step is not session + gap (the drift)", () => {
    expect(currentTiming([], 5)).toEqual({ session: 60, gap: 5, mixed: false });
    expect(currentTiming([{ slotDurationMinutes: 60, sessionMinutes: 55 }], 5)).toEqual({ session: 55, gap: 5, mixed: false });
    expect(currentTiming([{ slotDurationMinutes: 55, sessionMinutes: null }], 5)).toEqual({ session: 55, gap: 5, mixed: true });
    expect(currentTiming([{ slotDurationMinutes: 60, sessionMinutes: 55 }, { slotDurationMinutes: 60, sessionMinutes: 55 }, { slotDurationMinutes: 30, sessionMinutes: null }], 5).session).toBe(55);
  });
  it("names the hours too short for one session, and refuses numbers out of range", () => {
    expect(timingProblem(55, 5, [{ weekday: 1, startTime: "08:00", endTime: "12:00" }])).toBeNull();
    expect(timingProblem(90, 5, [{ weekday: 1, startTime: "08:00:00", endTime: "09:00:00" }])).toBe("Monday 08:00–09:00 is shorter than one 90-minute session. Make those hours longer first.");
    expect(timingProblem(4, 0, [])).toMatch(/Session length/);
    expect(timingProblem(60, 300, [])).toMatch(/gap/);
  });
});
