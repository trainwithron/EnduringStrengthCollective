import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { anchorHours, dayBeforeDue, dayBeforeMessage, dayBeforeWindow, freeCancelUntil, quietStartedAt, whenPhrase } from "./day-before-reminder";

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

describe("quiet hours (Ron, Nov 20, wave 3 R8)", () => {
  const ny = "America/New_York";
  const quiet = (s: number | null, e: number | null, timeZone = ny) => ({ quietStart: s, quietEnd: e, timeZone });
  const six = "2026-11-24T11:00:00.000Z"; // Tuesday 6:00 AM in New York
  const b6 = (over: Partial<Parameters<typeof dayBeforeDue>[0]> = {}) => ({ startAt: six, createdAt: "2026-11-01T00:00:00Z", remindedFor: null, windowHours: 24, ...over });

  it("a 6 AM session, quiet 9 PM to 7 AM: not at 4:30 AM the day before (inside quiet hours) but 8:30 to 9 PM two evenings before, still before the cutoff", () => {
    const w = dayBeforeWindow(six, 24, quiet(21, 7));
    expect(w.movedForQuiet).toBe(true);
    expect(w.until.toISOString()).toBe("2026-11-23T02:00:00.000Z"); // Sunday 9:00 PM
    expect(w.from.toISOString()).toBe("2026-11-23T01:30:00.000Z"); // Sunday 8:30 PM
    expect(w.until.getTime()).toBeLessThan(freeCancelUntil(six, 24).getTime());
    expect(dayBeforeDue(b6(), new Date("2026-11-23T01:45:00.000Z"), quiet(21, 7))).toBe(true); // 8:45 PM
    expect(dayBeforeDue(b6(), new Date("2026-11-23T01:59:00.000Z"), quiet(21, 7))).toBe(true); // 8:59 PM
    expect(dayBeforeDue(b6(), new Date("2026-11-23T02:00:00.000Z"), quiet(21, 7))).toBe(false); // 9:00 PM: quiet
    expect(dayBeforeDue(b6(), new Date("2026-11-23T09:30:00.000Z"), quiet(21, 7))).toBe(false); // 4:30 AM: quiet
    expect(dayBeforeDue(b6(), new Date("2026-11-23T01:20:00.000Z"), quiet(21, 7))).toBe(false); // 8:20 PM: not yet
  });
  it("without quiet hours, or when the usual moment is outside them, it goes out at the usual time", () => {
    expect(dayBeforeWindow(six, 24, quiet(null, null)).movedForQuiet).toBe(false);
    expect(dayBeforeDue(b6(), new Date("2026-11-23T09:30:00.000Z"), quiet(null, null))).toBe(true);
    expect(dayBeforeDue(b6(), new Date("2026-11-23T09:30:00.000Z"))).toBe(true);
    // 3 PM session: usual moment 1:30 PM, outside 9 PM to 7 AM
    expect(dayBeforeWindow(start, 24, quiet(21, 7)).movedForQuiet).toBe(false);
    expect(dayBeforeDue(booking(), at(25), quiet(21, 7))).toBe(true);
  });
  it("a window that does not cross midnight (1 PM to 3 PM) moves it to 12:30 to 1 PM", () => {
    const four = "2026-11-24T21:00:00.000Z"; // 4:00 PM, usual moment 2:30 PM the day before
    const w = dayBeforeWindow(four, 24, quiet(13, 15));
    expect(w.movedForQuiet).toBe(true);
    expect(w.until.toISOString()).toBe("2026-11-23T18:00:00.000Z"); // 1:00 PM
    expect(w.from.toISOString()).toBe("2026-11-23T17:30:00.000Z");
  });
  it("finds when quiet hours began in any time zone, half-hour ones too", () => {
    expect(quietStartedAt(new Date("2026-11-23T17:45:00.000Z"), quiet(22, 6, "Asia/Kolkata"))?.toISOString()).toBe("2026-11-23T16:30:00.000Z"); // 11:15 PM -> 10 PM IST
    expect(quietStartedAt(new Date("2026-11-23T15:00:00.000Z"), quiet(22, 6, "Asia/Kolkata"))).toBeNull(); // 8:30 PM IST: not quiet
  });
  it("the one-hour reminder (a session at most two hours away) goes through quiet hours, by push and by email; the day-before pass uses each client's own quiet hours", () => {
    const job = readFileSync(join(__dirname, "..", "app/api/cron/session-reminder/route.ts"), "utf8").replace(/\r\n/g, "\n");
    expect(job).toContain("`/groups/${booking.group_id}/calendar`,\n      { ignoreQuiet: true }");
    expect(job).toContain("emailClientNotice(supabase, booking.athlete_id, mail.subject, mail.text, { ignoreQuiet: true })");
    expect(job).toContain("windowByCoach.get(b.coach_id) }, now, quietOf(b))");
  });
});
