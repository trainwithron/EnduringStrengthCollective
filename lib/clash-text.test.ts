import { describe, expect, it } from "vitest";
import { clashText } from "./day-time-grid";

const maria = { startMin: 18 * 60, endMin: 18 * 60 + 55, name: "Maria Guiterrez" };

describe("clashText names the session in the way", () => {
  it("an overlap says who and when", () => {
    expect(clashText({ problem: "taken", startMin: 18 * 60 + 30, endMin: 19 * 60 + 25, sessions: [maria], bufferMin: 0, clientName: "Brendan Jacobs" })).toBe(
      "This overlaps Maria Guiterrez's session, 6:00 PM to 6:55 PM. Pick another time, or move Maria Guiterrez's session first."
    );
  });
  it("the session just booked for this client is said to be that, with nothing to fix", () => {
    const own = { ...maria, name: "Brendan Jacobs" };
    expect(clashText({ problem: "taken", startMin: 18 * 60, endMin: 18 * 60 + 55, sessions: [own], bufferMin: 0, clientName: "Brendan Jacobs" })).toMatch(/just booked for Brendan Jacobs, 6:00 PM to 6:55 PM/);
  });
  it("a gap clash names the gap and the session", () => {
    expect(clashText({ problem: "buffer", startMin: 19 * 60, endMin: 19 * 60 + 55, sessions: [maria], bufferMin: 10, clientName: "Brendan Jacobs" })).toMatch(/within your 10-minute gap of Maria Guiterrez's session, 6:00 PM to 6:55 PM/);
  });
});
