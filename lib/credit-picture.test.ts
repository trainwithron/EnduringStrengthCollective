import { describe, it, expect } from "vitest";
import { buildCreditPicture, clientCreditPictureLine, coachCreditPictureLine, countBookings, creditPictureDetail } from "./credit-picture";

const NONE = "No sessions on your account right now";

describe("where a client's sessions stand", () => {
  it("is the plain balance when nothing is booked", () => {
    const p = buildCreditPicture({ balance: 8, booked: 0, toMark: 0 });
    expect(coachCreditPictureLine(p)).toBe("8 left");
    expect(clientCreditPictureLine(p, NONE)).toBe("8 left");
  });
  it("shows what is booked and what still needs a time", () => {
    const p = buildCreditPicture({ balance: 8, booked: 4, toMark: 0 });
    expect(p).toMatchObject({ left: 8, booked: 4, toBook: 4, owed: 0 });
    expect(coachCreditPictureLine(p)).toBe("8 left · 4 booked · 4 to book");
    expect(clientCreditPictureLine(p, NONE)).toBe("8 left · 4 booked");
  });
  it("is fully booked with nothing left to book", () => {
    expect(coachCreditPictureLine(buildCreditPicture({ balance: 4, booked: 4, toMark: 0 }))).toBe("4 left · 4 booked");
  });
  it("says owed (to the coach only) when more are booked than are left", () => {
    const p = buildCreditPicture({ balance: 8, booked: 10, toMark: 0 });
    expect(p.owed).toBe(2);
    expect(coachCreditPictureLine(p)).toBe("8 left · 10 booked · owed 2");
    expect(clientCreditPictureLine(p, NONE)).toBe("8 left · 10 booked");
    expect(clientCreditPictureLine(p, NONE)).not.toMatch(/owed/);
  });
  it("lists past sessions still to be marked, so nothing hides", () => {
    expect(coachCreditPictureLine(buildCreditPicture({ balance: 8, booked: 4, toMark: 2 }))).toBe("8 left · 4 booked · 4 to book · 2 to mark");
    expect(coachCreditPictureLine(buildCreditPicture({ balance: 3, booked: 0, toMark: 1 }))).toBe("3 left · 1 to mark");
    // Never shown to the client.
    expect(clientCreditPictureLine(buildCreditPicture({ balance: 3, booked: 0, toMark: 1 }), NONE)).toBe("3 left");
  });
  it("a negative balance is already owed, and booked ones add to it", () => {
    const p = buildCreditPicture({ balance: -2, booked: 0, toMark: 0 });
    expect(p).toMatchObject({ left: 0, owed: 2 });
    expect(coachCreditPictureLine(p)).toBe("0 left · owed 2");
    const q = buildCreditPicture({ balance: -2, booked: 3, toMark: 0 });
    expect(q.owed).toBe(5);
    expect(coachCreditPictureLine(q)).toBe("0 left · 3 booked · owed 5");
  });
  it("a client with nothing and nothing booked gets the neutral line, not a warning", () => {
    expect(clientCreditPictureLine(buildCreditPicture({ balance: 0, booked: 0, toMark: 0 }), NONE)).toBe(NONE);
    expect(clientCreditPictureLine(buildCreditPicture({ balance: null, booked: 0, toMark: 0 }), NONE)).toBe(NONE);
    expect(clientCreditPictureLine(buildCreditPicture({ balance: 0, booked: 2, toMark: 0 }), NONE)).toBe("0 left · 2 booked");
  });
  it("a series with many future sessions counts every one", () => {
    const p = buildCreditPicture({ balance: 12, booked: 52, toMark: 0 });
    expect(coachCreditPictureLine(p)).toBe("12 left · 52 booked · owed 40");
  });
  it("shows the ledger detail only when both numbers are known", () => {
    expect(creditPictureDetail(buildCreditPicture({ balance: 8, booked: 4, toMark: 0, bought: 12, done: 4 }))).toBe("(12 bought, 4 done)");
    expect(creditPictureDetail(buildCreditPicture({ balance: 8, booked: 4, toMark: 0, bought: 12 }))).toBeNull();
    expect(creditPictureDetail(buildCreditPicture({ balance: 8, booked: 0, toMark: 0 }))).toBeNull();
  });
  it("never goes below zero on its own numbers", () => {
    expect(buildCreditPicture({ balance: 5, booked: -3, toMark: -1 })).toMatchObject({ booked: 0, toMark: 0, toBook: 5, owed: 0 });
  });
});

describe("counting sessions from the database rows", () => {
  const now = new Date("2026-10-10T12:00:00Z");
  it("counts future ones as booked and past unattended ones as to mark, per client and group", () => {
    const m = countBookings(
      [
        { athlete_id: "a", group_id: "g", start_at: "2026-10-11T12:00:00Z" },
        { athlete_id: "a", group_id: "g", start_at: "2026-10-18T12:00:00Z" },
        { athlete_id: "a", group_id: "g", start_at: "2026-10-05T12:00:00Z", attended_at: null },
        { athlete_id: "a", group_id: "g", start_at: "2026-10-04T12:00:00Z", attended_at: "2026-10-04T13:00:00Z" },
        { athlete_id: "b", group_id: "g", start_at: "2026-10-12T12:00:00Z" },
        { athlete_id: "a", group_id: "g2", start_at: "2026-10-12T12:00:00Z" },
      ],
      now
    );
    expect(m.get("a:g")).toEqual({ booked: 2, toMark: 1 });
    expect(m.get("b:g")).toEqual({ booked: 1, toMark: 0 });
    expect(m.get("a:g2")).toEqual({ booked: 1, toMark: 0 });
    expect(m.get("c:g")).toBeUndefined();
  });
  it("a session starting right now is still booked", () => {
    expect(countBookings([{ athlete_id: "a", group_id: "g", start_at: now.toISOString() }], now).get("a:g")).toEqual({ booked: 1, toMark: 0 });
  });
});
