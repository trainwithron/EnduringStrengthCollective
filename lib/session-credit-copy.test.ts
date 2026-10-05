import { describe, expect, it } from "vitest";
import { sessionBalanceLine, NO_SESSIONS_LINE } from "./session-credit-copy";

describe("sessionBalanceLine", () => {
  it("shows the count when sessions are available", () => {
    expect(sessionBalanceLine(12)).toBe("12 sessions left");
    expect(sessionBalanceLine(1)).toBe("1 session left");
  });
  it("stays neutral at zero and below", () => {
    expect(sessionBalanceLine(0)).toBe(NO_SESSIONS_LINE);
    expect(sessionBalanceLine(-1)).toBe(NO_SESSIONS_LINE);
    expect(sessionBalanceLine(0)).not.toMatch(/remaining|0/i);
  });
});
