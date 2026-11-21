import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { mapFreeBusyResponse } from "./google-calendar";

// Wave 2 C4 (Ron, Nov 20): personal Google Calendar events block booking times. Busy times only, read live, nothing stored.
const read = (p: string) => readFileSync(join(__dirname, "..", p), "utf8");

describe("Google's answer", () => {
  it("is start and end times only; an unusable entry is dropped", () => {
    const busy = mapFreeBusyResponse({
      calendars: {
        primary: {
          busy: [
            { start: "2026-11-21T15:00:00Z", end: "2026-11-21T16:00:00Z" },
            { start: "2026-11-21T17:00:00Z", end: "2026-11-21T17:00:00Z" },
            { start: "nonsense", end: "2026-11-21T18:00:00Z" },
          ],
        },
      },
    });
    expect(busy).toEqual([{ start: "2026-11-21T15:00:00Z", end: "2026-11-21T16:00:00Z" }]);
  });
  it("a calendar Google could not read is an error (the caller then offers times as before), never 'free all day'", () => {
    expect(() => mapFreeBusyResponse({ calendars: { primary: { errors: [{ reason: "notFound" }] } } })).toThrow();
    expect(() => mapFreeBusyResponse({})).toThrow();
  });
});

describe("where it is used", () => {
  it("the client's day page and the public booking page both get the coach's Google busy times", () => {
    expect(read("lib/coach-busy.ts")).toContain("googleBusyRanges(coachId, fromIso, toIso),");
    expect(read("lib/public-booking-store.ts")).toContain("googleBusyRanges(coachId, from.toISOString(), to.toISOString())");
  });
  it("reads busy times only: nothing about the events, nothing stored, a short timeout, and any failure means no Google times", () => {
    const src = read("lib/google-busy.ts");
    expect(src).not.toContain("google_calendar_personal_events");
    expect(src).not.toContain("listPersonalCalendarEvents");
    expect(src).toContain("AbortSignal.timeout(GOOGLE_BUSY_TIMEOUT_MS)");
    expect(src).toMatch(/catch \{\s*return \[\];\s*\}/);
    const lib = read("lib/google-calendar.ts");
    expect(lib).toContain("`${GOOGLE_CALENDAR_API_BASE}/freeBusy`");
    expect(lib).toContain('items: [{ id: "primary" }]');
  });
});
