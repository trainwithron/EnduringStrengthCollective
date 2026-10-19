import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { CancelSessionDialog } from "@/components/coach/session-cancel-dialog";

const read = (p: string) => readFileSync(p, "utf8").replace(/\r\n/g, "\n");

// Oct 19: Ron picked Hewan Belete to schedule her at 10:00. A tap on the day grid landed on Cindie Downing's booked 9:00 block (right above the slot), which opened the CANCEL dialog; its first button "Just this one" removed
// Cindie's 9:00 for that day (the series was updated at 12:31:59, 10 seconds before Hewan was booked). Nothing in book_session cancels anything.
describe("scheduling one client can never cancel another client's session", () => {
  const grid = read("components/coach/desktop/day-time-grid.tsx");
  it("while a client is picked for scheduling, a booked session is not a cancel button", () => {
    expect(grid).toContain("item.bookingId && item.startMs > Date.now() && !client ? (");
    // the only place a booked block opens the cancel dialog is that button
    expect(grid.match(/setCancelTarget\(\{/g)?.length).toBe(1);
    expect(grid.indexOf("!client ? (")).toBeLessThan(grid.indexOf("setCancelTarget({"));
    expect(grid).toContain("To cancel this session, clear the picked client first.");
  });
  it("booking never touches any booking but the new one: the book step calls only book_session and the new booking's own type update", () => {
    const book = grid.slice(grid.indexOf("async function book()"), grid.indexOf("async function undo()"));
    expect(book).toContain('rpc("book_session"');
    expect(book).not.toContain("cancel_booking");
    expect(book).not.toMatch(/\.delete\(|\.update\(\{ status/);
    expect(book).toContain('.update({ session_type_id: typeId }).eq("id", bookingId as string)');
  });
  it("Undo can only cancel the booking that was just made", () => {
    const undo = grid.slice(grid.indexOf("async function undo()"), grid.indexOf("const [cancelTarget"));
    expect(undo).toContain("p_booking_id: b.bookingId");
    expect(undo).toContain("const b = booked;");
  });
});

describe("the cancel dialog says exactly what it cancels", () => {
  const target = { bookingId: "b1", seriesId: null as string | null, name: "Cindie Downing", whenLabel: "Mon, Oct 19, 9:00 AM" };
  it("names the client and the time, says it books nothing, and the button names the session", () => {
    const html = renderToStaticMarkup(createElement(CancelSessionDialog, { target, onClose: () => {}, onDone: () => {} }));
    expect(html).toContain("Cancel a booked session");
    expect(html).toContain("Cindie Downing");
    expect(html).toContain("Mon, Oct 19, 9:00 AM");
    expect(html).toContain("It does not book anything");
    expect(html).toContain("Cancel Cindie Downing&#x27;s session");
    expect(html).toContain("Keep the session");
    expect(html).not.toContain("Just this one");
  });
  it("a session in a weekly schedule says which one and which ones: only this date, or this one and every later one", () => {
    const html = renderToStaticMarkup(createElement(CancelSessionDialog, { target: { ...target, seriesId: "s1" }, onClose: () => {}, onDone: () => {} }));
    expect(html).toContain("Cancel only this one (Mon, Oct 19, 9:00 AM)");
    expect(html).toContain("Cancel this one and every later one");
    expect(html).not.toContain(">Just this one<");
  });
});

describe("the Book pop-up appears at the time that was picked", () => {
  const grid = read("components/coach/desktop/day-time-grid.tsx");
  it("is a pop-up (a bottom sheet on a phone) the moment a time is picked, not a box at the bottom of the grid to scroll to", () => {
    expect(grid).toContain('aria-label="Book this session"');
    expect(grid).toContain("fixed inset-0 z-50 flex items-end sm:items-center");
    expect(grid).not.toContain("scrollIntoView");
    expect(grid).not.toContain('aria-label="Confirm session"');
  });
  it("says plainly what will happen, edits the time, length and type right there, and has one Book button", () => {
    expect(grid).toContain("Book {client.fullName}, {dateLabel}, {pendingLabel}");
    expect(grid).toContain("This books one session. Nothing else on the calendar is changed.");
    expect(grid).toContain("setPendingMin(parseClockMinutes(e.target.value))");
    expect(grid).toContain('aria-label="Session type for this booking"');
    expect(grid.match(/onClick=\{book\}/g)?.length).toBe(1);
  });
  it("is green and the cancel dialog is red, so the two can never be mistaken for each other", () => {
    expect(grid).toContain("bg-positive text-graphite");
    const cancel = read("components/coach/session-cancel-dialog.tsx");
    expect(cancel).toContain("text-rust");
    expect(cancel).not.toContain("positive");
  });
  it("the Undo notice stays in view at the bottom of the screen", () => {
    expect(grid).toContain("fixed bottom-4 left-1/2 -translate-x-1/2 z-40");
  });
});
