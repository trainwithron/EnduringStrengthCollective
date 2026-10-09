import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { bookingRefusalMessage, failedWeeklyDates, BOOKING_REFUSAL_FALLBACK } from "./booking-refusal-copy";

const read = (rel: string) => readFileSync(join(__dirname, "..", rel), "utf8").replace(/\r\n/g, "\n");

describe("a refused booking says what is actually wrong", () => {
  it("each server refusal gets its own plain sentence", () => {
    expect(bookingRefusalMessage("that session needs more advance notice")).toBe("That time is too soon. Your coach needs more notice than that.");
    expect(bookingRefusalMessage("this session has already started; ask your coach")).toBe("That session has already started. Ask your coach.");
    expect(bookingRefusalMessage("your coach confirms moves: ask for the new time instead")).toBe("Your coach confirms moves. Ask for the new time instead.");
    expect(bookingRefusalMessage("that time is outside your coach's hours")).toBe("That time is outside your coach's hours.");
    expect(bookingRefusalMessage("that slot was just taken")).toBe("That slot was just taken. Try another.");
    expect(bookingRefusalMessage("you already asked to move this session; your coach has not answered yet")).toContain("already asked");
  });
  it("anything else gets the generic line, never 'just taken'", () => {
    expect(bookingRefusalMessage("something odd")).toBe(BOOKING_REFUSAL_FALLBACK);
    expect(bookingRefusalMessage(null)).toBe(BOOKING_REFUSAL_FALLBACK);
    expect(BOOKING_REFUSAL_FALLBACK).not.toMatch(/just taken/);
    expect(bookingRefusalMessage("x", "Custom.")).toBe("Custom.");
  });
});

describe("which weekly sessions did not get booked", () => {
  it("lists the weeks with no booking on that day", () => {
    const first = new Date(2026, 9, 12, 9, 0).toISOString(); // Mon Oct 12, 9:00 local
    const booked = [new Date(2026, 9, 12, 9, 0), new Date(2026, 9, 26, 9, 0)].map((d) => d.toISOString());
    const failed = failedWeeklyDates(first, 4, booked);
    expect(failed.map((d) => `${d.getMonth() + 1}/${d.getDate()}`)).toEqual(["10/19", "11/2"]);
  });
  it("is empty when every week booked", () => {
    const first = new Date(2026, 9, 12, 9, 0).toISOString();
    const all = [0, 1, 2].map((i) => new Date(2026, 9, 12 + 7 * i, 9, 0).toISOString());
    expect(failedWeeklyDates(first, 3, all)).toEqual([]);
  });
});

describe("the client booking screens", () => {
  it("leaving the waitlist works for waiting and offered", () => {
    expect(read("components/athlete/waitlist-join-button.tsx")).toContain('.in("status", ["waiting", "offered"])');
  });
  it("the freed-slot push opens that day's calendar", () => {
    const cron = read("app/api/cron/process-booking-waitlist/route.ts");
    expect(cron).toContain("/calendar/${slotDay}");
    expect(cron).toContain("dateKeyInZone(athleteZone");
  });
  it("cancelling a series checks the error and says what happens to the balance; the button says what it does", () => {
    const src = read("components/athlete/cancel-booking-button.tsx");
    expect(src).toContain("const { error: seriesError } = await supabase.rpc(\"cancel_recurring_booking_series\"");
    expect(src).toContain("if (seriesError) {");
    expect(src).toContain("goes back to your balance");
    expect(src).toContain('"Cancel session"');
    expect(src).not.toContain("Booked ✓ Cancel");
  });
  it("a manage-booking page calls only a cancelled booking cancelled", () => {
    const src = read("components/public/manage-booking-flow.tsx");
    expect(src).toContain('status === "cancelled"');
    expect(src).toContain("This session has passed");
    expect(src).toContain("To book another time, contact {coachName}.");
  });
  it("the weekly booking controls are phone-sized and name the weeks that failed", () => {
    const src = read("components/athlete/recurring-booking-button.tsx");
    expect(src).toContain("h-11");
    expect(src).toContain("failedWeeklyDates(");
    expect(src).toContain("Open your calendar");
  });
});
