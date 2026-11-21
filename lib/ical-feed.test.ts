import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { buildIcs, eventSummary, firstNameOnly, foldLine, icsText, FEED_TOKEN_PATTERN } from "./ical-feed";

// Wave 3 C8 (Ron, Nov 20): a private read-only calendar link for Apple Calendar, Outlook or any calendar app, first names only.
const read = (p: string) => readFileSync(join(__dirname, "..", p), "utf8").replace(/\r\n/g, "\n");

describe("what each event says", () => {
  it("first name only, never the last name", () => {
    expect(firstNameOnly("Hewan Belete")).toBe("Hewan");
    expect(firstNameOnly("  Jamie  ")).toBe("Jamie");
    expect(firstNameOnly(null)).toBe("");
    expect(eventSummary({ id: "1", kind: "session", startAt: "", endAt: "", name: "Hewan Belete" })).toBe("Session: Hewan");
    expect(eventSummary({ id: "2", kind: "call", startAt: "", endAt: "", name: "Jamie Lee" })).toBe("Call: Jamie");
    expect(eventSummary({ id: "3", kind: "session", startAt: "", endAt: "", name: null })).toBe("Session");
  });
  it("escapes what the calendar format needs escaped", () => {
    expect(icsText("a;b,c\\d\ne")).toBe("a\\;b\\,c\\\\d\\ne");
  });
  it("folds long lines at 75 bytes, never splitting a character", () => {
    const long = "SUMMARY:" + "é".repeat(60);
    const folded = foldLine(long);
    for (const part of folded.split("\r\n")) expect(new TextEncoder().encode(part).length).toBeLessThanOrEqual(75);
    expect(folded.split("\r\n ").join("")).toBe(long);
  });
});

describe("the calendar file", () => {
  const now = new Date("2026-11-20T15:00:00Z");
  const ics = buildIcs(
    [
      { id: "b1", kind: "session", startAt: "2026-11-21T14:00:00Z", endAt: "2026-11-21T15:00:00Z", name: "Hewan Belete" },
      { id: "d1", kind: "call", startAt: "2026-11-22T16:30:00.000Z", endAt: "2026-11-22T16:45:00.000Z", name: "Jamie Lee" },
      { id: "bad", kind: "session", startAt: "not a date", endAt: "", name: "X" },
    ],
    "Spotlight: Ron",
    now
  );
  it("is a valid subscribable calendar with UTC times and stable ids", () => {
    expect(ics.startsWith("BEGIN:VCALENDAR\r\nVERSION:2.0\r\n")).toBe(true);
    expect(ics.endsWith("END:VCALENDAR\r\n")).toBe(true);
    expect(ics).toContain("DTSTART:20261121T140000Z");
    expect(ics).toContain("DTEND:20261122T164500Z");
    expect(ics).toContain("UID:session-b1@spotlightcoaching.app");
    expect(ics).toContain("UID:call-d1@spotlightcoaching.app");
    expect(ics).toContain("DTSTAMP:20261120T150000Z");
    expect(ics).toContain("REFRESH-INTERVAL;VALUE=DURATION:PT1H");
    expect(ics.split("BEGIN:VEVENT").length - 1).toBe(2);
  });
  it("carries no last names and no other details", () => {
    expect(ics).not.toContain("Belete");
    expect(ics).not.toContain("Lee");
    expect(ics).not.toContain("DESCRIPTION");
    expect(ics).not.toContain("ATTENDEE");
    expect(ics).not.toContain("LOCATION");
  });
});

describe("the link", () => {
  it("is a 64-character secret", () => {
    expect(FEED_TOKEN_PATTERN.test("a".repeat(64))).toBe(true);
    expect(FEED_TOKEN_PATTERN.test("a".repeat(63))).toBe(false);
    expect(FEED_TOKEN_PATTERN.test("A".repeat(64))).toBe(false);
  });
  it("the feed reads only the coach the secret belongs to, confirmed sessions and calls, first names only, and a failed read is never an empty calendar", () => {
    const route = read("app/api/calendar-feed/[token]/route.ts");
    expect(route).toContain("FEED_TOKEN_PATTERN.test(token)");
    expect(route).toContain('.from("coach_calendar_feeds")');
    expect(route).toContain('.eq("coach_id", coachId)');
    expect(route).toContain("limitByIp");
    expect(route).toContain("Retry-After");
    expect(route).toContain("if (sessions.failed || sessions.truncated || calls.failed || calls.truncated) return TRY_LATER();");
    expect(route).toContain("if (feedError) return TRY_LATER();");
    expect(route).not.toContain("prospect_email");
    expect(route).not.toContain("prospect_phone");
    expect(read("lib/supabase/middleware.ts")).toContain('pathname.startsWith("/api/calendar-feed/")');
  });
  it("sits next to Google Calendar in Settings, with a new link and a turn-off", () => {
    expect(read("app/(coach)/groups/[groupId]/settings/page.tsx")).toContain("<CalendarFeedLink />");
    const ui = read("components/coach/calendar-feed-link.tsx");
    expect(ui).toContain('rpc("new_calendar_feed_link")');
    expect(ui).toContain('rpc("turn_off_calendar_feed")');
  });
});
