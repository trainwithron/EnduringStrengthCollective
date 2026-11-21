import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { anchorHours, dayBeforeDue, dayBeforeMessage, freeCancelUntil, whenPhrase } from "./day-before-reminder";

// Wave 2 C2 (Ron, Nov 20): "about 1 hour before the cancellation window" (a 24-hour policy sends at about 25 to 26 hours out).
const H = 3600000;
const start = "2026-11-22T20:00:00.000Z"; // Sunday 3:00 PM in New York
const at = (hoursBefore: number) => new Date(new Date(start).getTime() - hoursBefore * H);
const booking = (over: Partial<Parameters<typeof dayBeforeDue>[0]> = {}) => ({ startAt: start, createdAt: "2026-11-01T00:00:00Z", remindedFor: null, windowHours: 24, ...over });

describe("when the day-before reminder goes out", () => {
  it("a 24-hour window: due from 25.5 hours before until the cutoff at 24 hours, not before and not after", () => {
    expect(dayBeforeDue(booking(), at(26))).toBe(false);
    expect(dayBeforeDue(booking(), at(25.5))).toBe(true);
    expect(dayBeforeDue(booking(), at(25))).toBe(true);
    expect(dayBeforeDue(booking(), at(24.1))).toBe(true);
    expect(dayBeforeDue(booking(), at(24))).toBe(false);
    expect(dayBeforeDue(booking(), at(10))).toBe(false);
  });
  it("follows the coach's own window (48 hours: about 49.5 hours out) and uses 24 hours when the coach has none", () => {
    expect(dayBeforeDue(booking({ windowHours: 48 }), at(49))).toBe(true);
    expect(dayBeforeDue(booking({ windowHours: 48 }), at(25))).toBe(false);
    expect(anchorHours(0)).toBe(24);
    expect(anchorHours(null)).toBe(24);
    expect(dayBeforeDue(booking({ windowHours: 0 }), at(25))).toBe(true);
  });
  it("once per start time: not again for the same time, again after the session moved", () => {
    expect(dayBeforeDue(booking({ remindedFor: start }), at(25))).toBe(false);
    expect(dayBeforeDue(booking({ remindedFor: "2026-11-20T20:00:00.000Z" }), at(25))).toBe(true);
    expect(dayBeforeDue(booking({ remindedFor: "2026-11-22T20:00:00+00:00" }), at(25))).toBe(false);
  });
  it("none for a session booked after the moment it would have gone out, and never inside the last two hours", () => {
    expect(dayBeforeDue(booking({ createdAt: at(25).toISOString() }), at(24.5))).toBe(false);
    expect(dayBeforeDue(booking({ windowHours: 1 }), at(1.5))).toBe(false);
  });
});

describe("what it says", () => {
  const tz = "America/New_York";
  it("when, with whom, and until when a cancel or move is free, in the client's own time", () => {
    const m = dayBeforeMessage({ startAt: start, windowHours: 24, coachName: "Ron Arnold", timeZone: tz, now: at(25) });
    expect(m.title).toBe("Your session tomorrow");
    expect(m.body).toBe("Your session with Ron is tomorrow at 3:00 PM. Need to cancel or move it? You can until today at 3:00 PM.");
    expect(freeCancelUntil(start, 24).toISOString()).toBe("2026-11-21T20:00:00.000Z");
  });
  it("a session further out says the weekday", () => {
    expect(whenPhrase(new Date(start), tz, at(49))).toBe("Sunday at 3:00 PM");
  });
});

describe("the job", () => {
  const route = readFileSync(join(__dirname, "..", "app/api/cron/session-reminder/route.ts"), "utf8");
  it("claims each booking for its start time before sending, and only while the session has not moved", () => {
    expect(route).toContain(".update({ day_before_reminded_for: startIso })");
    expect(route).toContain('.eq("start_at", startIso)');
    expect(route).toContain("`day_before_reminded_for.is.null,day_before_reminded_for.neq.${startIso}`");
  });
  it("a phone alert first, an email only when no phone was reached, and the claim given back when nothing was delivered", () => {
    expect(route).toMatch(/if \(count === 0\) \{\s*const mail = dayBeforeEmail/);
    expect(route).toContain('.update({ day_before_reminded_for: null }).eq("id", b.id).eq("day_before_reminded_for", startIso)');
  });
});
