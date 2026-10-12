import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const read = (rel: string) => readFileSync(join(__dirname, "..", rel), "utf8").replace(/\r\n/g, "\n");

describe("click a booked session on the calendar to cancel it", () => {
  it("a future one-off session is cancelled with the same refund rule as the client's panel", () => {
    const src = read("components/coach/session-cancel-dialog.tsx");
    expect(src).toContain('rpc("cancel_booking_and_refund_credit"');
    expect(src).toContain("Cancel this session? Anything already taken for it goes back to their sessions.");
  });
  it("a session in a recurring schedule asks: just this one, or this and the rest of the series", () => {
    const src = read("components/coach/session-cancel-dialog.tsx");
    expect(src).toContain("Just this one");
    expect(src).toContain("This and the rest of the series");
    expect(src).toContain('seriesAction("end_from_here")');
    expect(read("app/api/series/occurrence/route.ts")).toContain('case "end_from_here"');
  });
  it("the day grid shows future booked sessions as clickable blocks, never past ones or group sessions", () => {
    const grid = read("components/coach/desktop/day-time-grid.tsx");
    expect(grid).toContain("item.bookingId && item.startMs > Date.now()");
    expect(grid).toContain("<CancelSessionDialog");
    const body = read("components/coach/calendar-page-body.tsx");
    expect(body).toContain("bookingId: b.id, seriesId: b.recurring_series_id ?? null");
  });
});
