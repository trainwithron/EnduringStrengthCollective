import { describe, it, expect } from "vitest";
import { clientCreditLine, coachCreditLine, owedAfterPending } from "./pending-credit-copy";

describe("the coach's line", () => {
  it("is the plain balance when nothing is pending", () => {
    expect(coachCreditLine(2, 0)).toBe("2 left");
    expect(coachCreditLine(0, 0)).toBe("0 left");
    expect(coachCreditLine(-1, 0)).toBe("Owed 1");
    expect(coachCreditLine(null, 0)).toBe("No sessions set up");
  });
  it("shows the pending sessions beside the balance", () => {
    expect(coachCreditLine(2, 1)).toBe("2 left, 1 pending");
    expect(coachCreditLine(2, 2)).toBe("2 left, 2 pending");
  });
  it("says what will be owed when more are pending than are left", () => {
    expect(coachCreditLine(1, 3)).toBe("1 left, 3 pending (2 owed)");
    expect(coachCreditLine(0, 1)).toBe("0 left, 1 pending (1 owed)");
    expect(coachCreditLine(-1, 1)).toBe("Owed 1, 1 pending (1 owed)");
  });
  it("counts owed sessions from what is left, never below zero", () => {
    expect(owedAfterPending(2, 1)).toBe(0);
    expect(owedAfterPending(2, 2)).toBe(0);
    expect(owedAfterPending(2, 3)).toBe(1);
    expect(owedAfterPending(-2, 1)).toBe(1);
    expect(owedAfterPending(0, 0)).toBe(0);
  });
});

describe("the client's line", () => {
  it("is unchanged when nothing is scheduled", () => {
    expect(clientCreditLine(2, 0)).toBe("2 sessions left");
    expect(clientCreditLine(1, 0)).toBe("1 session left");
    expect(clientCreditLine(0, 0)).toBe("No sessions on your account right now");
  });
  it("shows what is scheduled", () => {
    expect(clientCreditLine(2, 1)).toBe("2 sessions left (1 scheduled)");
    expect(clientCreditLine(0, 1)).toBe("0 sessions left (1 scheduled)");
  });
});
