import { describe, it, expect } from "vitest";
import { buildCreditPicture, clientCreditPictureLine, coachCreditPictureLine, countBookings, fetchBookingCounts } from "./credit-picture";

const NONE = "No sessions on your account right now";

describe("where a client's sessions stand", () => {
  it("is the plain balance when nothing is booked", () => {
    const p = buildCreditPicture({ balance: 8, booked: 0, toMark: 0 });
    expect(coachCreditPictureLine(p)).toBe("8 left");
    expect(clientCreditPictureLine(p, NONE)).toBe("8 left");
  });
  it("shows what is booked and what still needs a time", () => {
    const p = buildCreditPicture({ balance: 8, booked: 4, toMark: 0 });
    expect(p).toMatchObject({ left: 8, booked: 4, toBook: 4, owed: 0, bookedAhead: 0 });
    expect(coachCreditPictureLine(p)).toBe("8 left · 4 booked · 4 to book");
    expect(clientCreditPictureLine(p, NONE)).toBe("8 left · 4 booked");
  });
  it("is fully booked with nothing left to book", () => {
    expect(coachCreditPictureLine(buildCreditPicture({ balance: 4, booked: 4, toMark: 0 }))).toBe("4 left · 4 booked");
  });
  it("sessions booked beyond what is left are booked AHEAD, never owed", () => {
    const p = buildCreditPicture({ balance: 8, booked: 10, toMark: 0 });
    expect(p).toMatchObject({ owed: 0, bookedAhead: 2, toBook: 0 });
    expect(coachCreditPictureLine(p)).toBe("8 left · 10 booked ahead");
    expect(clientCreditPictureLine(p, NONE)).toBe("8 left · 10 booked");
  });
  it("a weekly schedule a year out does not read as a debt", () => {
    const p = buildCreditPicture({ balance: 0, booked: 52, toMark: 0 });
    expect(p.owed).toBe(0);
    expect(coachCreditPictureLine(p)).toBe("0 left · 52 booked ahead");
    const q = buildCreditPicture({ balance: 12, booked: 52, toMark: 0 });
    expect(coachCreditPictureLine(q)).toBe("12 left · 52 booked ahead");
  });
  it("lists past sessions still to be marked, so nothing hides", () => {
    expect(coachCreditPictureLine(buildCreditPicture({ balance: 8, booked: 4, toMark: 2 }))).toBe("8 left · 4 booked · 4 to book · 2 to mark");
    expect(coachCreditPictureLine(buildCreditPicture({ balance: 3, booked: 0, toMark: 1 }))).toBe("3 left · 1 to mark");
    // Never shown to the client.
    expect(clientCreditPictureLine(buildCreditPicture({ balance: 3, booked: 0, toMark: 1 }), NONE)).toBe("3 left");
  });
  it("owed is only what was already delivered beyond the balance (a negative balance), to the coach only", () => {
    const p = buildCreditPicture({ balance: -2, booked: 0, toMark: 0 });
    expect(p).toMatchObject({ left: 0, owed: 2 });
    expect(coachCreditPictureLine(p)).toBe("0 left · owed 2");
    const q = buildCreditPicture({ balance: -2, booked: 3, toMark: 0 });
    expect(q.owed).toBe(2);
    expect(coachCreditPictureLine(q)).toBe("0 left · 3 booked ahead · owed 2");
    expect(clientCreditPictureLine(q, NONE)).toBe("0 left · 3 booked");
    expect(clientCreditPictureLine(q, NONE)).not.toMatch(/owed/);
  });
  it("a client with nothing and nothing booked gets the neutral line, not a warning", () => {
    expect(clientCreditPictureLine(buildCreditPicture({ balance: 0, booked: 0, toMark: 0 }), NONE)).toBe(NONE);
    expect(clientCreditPictureLine(buildCreditPicture({ balance: null, booked: 0, toMark: 0 }), NONE)).toBe(NONE);
    expect(clientCreditPictureLine(buildCreditPicture({ balance: 0, booked: 2, toMark: 0 }), NONE)).toBe("0 left · 2 booked");
  });
  it("never goes below zero on its own numbers", () => {
    expect(buildCreditPicture({ balance: 5, booked: -3, toMark: -1 })).toMatchObject({ booked: 0, toMark: 0, toBook: 5, owed: 0 });
  });
});

describe("counting sessions from the database rows", () => {
  const now = new Date("2026-10-10T12:00:00Z");
  const row = (o: Partial<Parameters<typeof countBookings>[0][number]> & { start_at: string }) => ({ athlete_id: "a", group_id: "g", credit_state: "unsettled", ...o });
  it("counts future unsettled ones as booked and ended, unmarked ones as to mark, per client and group", () => {
    const m = countBookings(
      [
        row({ start_at: "2026-10-11T12:00:00Z", end_at: "2026-10-11T13:00:00Z" }),
        row({ start_at: "2026-10-18T12:00:00Z", end_at: "2026-10-18T13:00:00Z" }),
        row({ start_at: "2026-10-05T12:00:00Z", end_at: "2026-10-05T13:00:00Z" }),
        row({ start_at: "2026-10-04T12:00:00Z", end_at: "2026-10-04T13:00:00Z", attended_at: "2026-10-04T13:00:00Z" }),
        row({ athlete_id: "b", start_at: "2026-10-12T12:00:00Z", end_at: "2026-10-12T13:00:00Z" }),
        row({ group_id: "g2", start_at: "2026-10-12T12:00:00Z", end_at: "2026-10-12T13:00:00Z" }),
      ],
      now
    );
    expect(m.get("a:g")).toEqual({ booked: 2, toMark: 1, prepaidAhead: 0 });
    expect(m.get("b:g")).toEqual({ booked: 1, toMark: 0, prepaidAhead: 0 });
    expect(m.get("a:g2")).toEqual({ booked: 1, toMark: 0, prepaidAhead: 0 });
    expect(m.get("c:g")).toBeUndefined();
  });
  it("a no-show is done: it leaves 'to mark'", () => {
    const m = countBookings([row({ start_at: "2026-10-05T12:00:00Z", end_at: "2026-10-05T13:00:00Z", no_show: true })], now);
    expect(m.get("a:g")).toEqual({ booked: 0, toMark: 0, prepaidAhead: 0 });
  });
  it("a session still in progress is not yet 'to mark'", () => {
    const m = countBookings([row({ start_at: "2026-10-10T11:30:00Z", end_at: "2026-10-10T12:30:00Z" })], now);
    expect(m.get("a:g")).toEqual({ booked: 1, toMark: 0, prepaidAhead: 0 });
  });
  it("prepaid sessions ahead are counted apart, and past prepaid ones are not 'to mark' (they already took their session)", () => {
    const m = countBookings(
      [
        row({ start_at: "2026-10-12T12:00:00Z", end_at: "2026-10-12T13:00:00Z", credit_state: "prepaid" }),
        row({ start_at: "2026-10-02T12:00:00Z", end_at: "2026-10-02T13:00:00Z", credit_state: "prepaid" }),
      ],
      now
    );
    expect(m.get("a:g")).toEqual({ booked: 0, toMark: 0, prepaidAhead: 1 });
  });
});

describe("reading all the rows, past the 1000-row cap", () => {
  it("pages through every row and counts them all", async () => {
    const all = Array.from({ length: 2300 }, (_, i) => ({
      id: String(i).padStart(5, "0"),
      athlete_id: `a${i % 50}`,
      group_id: "g",
      start_at: "2099-01-01T00:00:00Z",
      end_at: "2099-01-01T01:00:00Z",
      credit_state: "unsettled",
    }));
    let calls = 0;
    const chain: any = {
      select: () => chain,
      eq: () => chain,
      in: () => chain,
      order: () => chain,
      range: (from: number, to: number) => {
        calls += 1;
        // The server returns at most 1000 rows whatever range is asked for.
        return Promise.resolve({ data: all.slice(from, Math.min(to + 1, from + 1000)), error: null });
      },
    };
    const sb = { from: () => chain } as any;
    const m = await fetchBookingCounts(sb, { coachId: "c" });
    let total = 0;
    m.forEach((v) => (total += v.booked));
    expect(total).toBe(2300);
    expect(calls).toBe(3);
  });
  it("fails soft, with no counts, when a page fails", async () => {
    const chain: any = { select: () => chain, eq: () => chain, in: () => chain, order: () => chain, range: () => Promise.resolve({ data: null, error: { message: "x" } }) };
    const m = await fetchBookingCounts({ from: () => chain } as any, { coachId: "c" });
    expect(m.size).toBe(0);
  });
});
