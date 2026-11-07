import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { scheduleRequestError, SCHEDULE_REQUEST_FALLBACK } from "@/components/athlete/my-schedule";

const read = (p: string) => readFileSync(join(__dirname, "..", p), "utf8").replace(/\r\n/g, "\n");
const DAY = "app/(coach)/groups/[groupId]/calendar/[date]/page.tsx";
const MONTH = "components/coach/calendar-page-body.tsx";

describe("Calendar and booking audit fixes", () => {
  it("My schedule shows the database's plain refusals as a sentence and never a technical one", () => {
    expect(scheduleRequestError("choose today or a later date")).toBe("Choose today or a later date.");
    expect(scheduleRequestError("this request was already handled")).toBe("This request was already handled.");
    expect(scheduleRequestError("not authorized")).toBe(SCHEDULE_REQUEST_FALLBACK);
    expect(scheduleRequestError('new row violates row-level security policy for table "x"')).toBe(SCHEDULE_REQUEST_FALLBACK);
    expect(scheduleRequestError(undefined)).toBe(SCHEDULE_REQUEST_FALLBACK);
  });

  it("Back from a day where a session is being moved keeps the move going, and the month says so with a way to stop", () => {
    expect(read(DAY)).toContain("const backHref = reschedulingBooking ? `${calendarHref}?month=${params.date.slice(0, 7)}&reschedule=${reschedulingBooking.id}` : calendarHref;");
    const month = read(MONTH);
    expect(month).toContain("session: pick a day");
    expect(month).toContain("Stop moving");
  });

  it("the month list matches the day page: no Reschedule when the coach schedules everyone, and the weekly series can be cancelled", () => {
    const month = read(MONTH);
    expect(month).toContain('.select("id, start_at, recurring_series_id")');
    expect(month).toContain('rescheduleHref={bookingMode === "coach_schedules" ? undefined');
    expect(month).toContain("recurringSeriesId={b.recurring_series_id}");
  });

  it("client-facing wording says 'time', not 'slot'", () => {
    expect(read("components/athlete/request-slot-button.tsx")).not.toContain("That slot was just taken");
  });

  it("the public booking page uses the plain zone name and says when the form could not start", () => {
    const flow = read("components/public/public-booking-flow.tsx");
    expect(flow).toContain("zoneLabel(timezone)");
    expect(flow).not.toContain('timezone.replace("_", " ")');
    expect(flow).toContain("We couldn&apos;t start the form. Reload the page.");
  });
});
