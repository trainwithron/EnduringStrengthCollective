import { describe, expect, it } from "vitest";
import { classSummaryLine, createProblem, friendlyGroupSessionError, joinView, spotsLeft } from "@/lib/group-sessions";

const base = { capacity: 6, joined: 3, mine: null, balance: 5, started: false, cancelled: false } as const;

describe("spots", () => {
  it("counts spots left and never goes negative", () => {
    expect(spotsLeft(6, 4)).toBe(2);
    expect(spotsLeft(6, 6)).toBe(0);
    expect(spotsLeft(6, 9)).toBe(0);
  });
});

describe("what a client sees", () => {
  it("one tap to join when there is room and a session on the account", () => {
    const v = joinView({ ...base });
    expect(v).toMatchObject({ action: "join", label: "Join", disabled: false });
    expect(v.note).toBe("3 spots left");
  });

  it("says one spot, not one spots", () => {
    expect(joinView({ ...base, joined: 5 }).note).toBe("1 spot left");
  });

  it("with no session on the account joining is blocked with a plain reason", () => {
    const v = joinView({ ...base, balance: 0 });
    expect(v.disabled).toBe(true);
    expect(v.note).toMatch(/session on your account/);
    expect(joinView({ ...base, balance: null }).disabled).toBe(true);
  });

  it("a full class offers the waiting list, which needs no session", () => {
    const v = joinView({ ...base, joined: 6, balance: 0 });
    expect(v).toMatchObject({ action: "waitlist", label: "Join waiting list", disabled: false });
  });

  it("someone who is in can leave", () => {
    expect(joinView({ ...base, mine: "joined" })).toMatchObject({ action: "leave", label: "Leave", disabled: false });
  });

  it("someone on the waiting list can leave it", () => {
    const v = joinView({ ...base, joined: 6, mine: "waitlisted" });
    expect(v.action).toBe("leave");
    expect(v.note).toMatch(/waiting list/);
  });

  it("a cancelled or started class cannot be joined", () => {
    expect(joinView({ ...base, cancelled: true })).toMatchObject({ action: "none", disabled: true });
    expect(joinView({ ...base, started: true })).toMatchObject({ action: "none", disabled: true });
    expect(joinView({ ...base, mine: "joined", started: true }).disabled).toBe(true);
  });

  it("attended is final", () => {
    expect(joinView({ ...base, mine: "attended" })).toMatchObject({ action: "none", label: "Attended" });
  });

  it("someone who left can join again", () => {
    expect(joinView({ ...base, mine: "cancelled" }).action).toBe("join");
  });
});

describe("creating a class", () => {
  const now = new Date("2026-10-10T12:00:00Z");
  const ok = { title: "Tuesday small group", startIso: "2026-10-13T22:00:00.000Z", durationMinutes: 60, capacity: 6 };

  it("accepts a good one", () => {
    expect(createProblem(ok, now)).toBeNull();
  });

  it("rejects each bad field", () => {
    expect(createProblem({ ...ok, title: "  " }, now)).toMatch(/name/);
    expect(createProblem({ ...ok, title: "x".repeat(81) }, now)).toMatch(/80/);
    expect(createProblem({ ...ok, startIso: "nope" }, now)).toMatch(/date/);
    expect(createProblem({ ...ok, startIso: "2026-10-01T10:00:00Z" }, now)).toMatch(/future/);
    expect(createProblem({ ...ok, durationMinutes: 2 }, now)).toMatch(/length/);
    expect(createProblem({ ...ok, capacity: 0 }, now)).toMatch(/Spots/);
    expect(createProblem({ ...ok, capacity: 51 }, now)).toMatch(/Spots/);
    expect(createProblem({ ...ok, capacity: 2.5 }, now)).toMatch(/Spots/);
    expect(createProblem({ ...ok, locationNote: "x".repeat(201) }, now)).toMatch(/200/);
  });
});

describe("errors", () => {
  it("turns database messages into plain words", () => {
    expect(friendlyGroupSessionError("no session credits remaining")).toMatch(/session on your account/);
    expect(friendlyGroupSessionError("already in this class")).toMatch(/already in/);
    expect(friendlyGroupSessionError("this class has already started")).toMatch(/already started/);
    expect(friendlyGroupSessionError("this class was cancelled")).toMatch(/cancelled/);
    expect(friendlyGroupSessionError("that time is already taken")).toMatch(/already booked/);
    expect(friendlyGroupSessionError("there are 6 people in this class. Remove someone first.")).toMatch(/There are 6 people/);
    expect(friendlyGroupSessionError("something odd")).toBe("That didn't work. Try again.");
    expect(friendlyGroupSessionError(undefined)).toBe("That didn't work. Try again.");
  });
});

describe("summary line", () => {
  it("shows spots, full, and waiting", () => {
    expect(classSummaryLine({ capacity: 6, joined: 4, waitlisted: 0 })).toBe("4 of 6 spots taken");
    expect(classSummaryLine({ capacity: 6, joined: 6, waitlisted: 2 })).toBe("Full (6), 2 waiting");
  });
});
