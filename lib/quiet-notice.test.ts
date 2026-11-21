import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { quietEndsAt, quietHoursNotice } from "./quiet-notice";

// Ron, Nov 20: a client who sends a request while the coach is in their quiet hours is told so: "It's late. Your coach has quiet hours set. Expect a reply in the morning."
// When the quiet hours end later in the day: "Expect a reply after {end time}", in the client's time zone.
const NY = "America/New_York"; // UTC-5 in November
const read = (p: string) => readFileSync(join(__dirname, "..", p), "utf8").replace(/\r\n/g, "\n");
const coach = (quietStart: number | null, quietEnd: number | null, timeZone = NY) => ({ quietStart, quietEnd, timeZone });
const nyAt = (hhmm: string, day = "2026-11-20") => new Date(new Date(`${day}T${hhmm}:00Z`).getTime() + 5 * 3600000); // that New York wall-clock time

describe("an overnight window (9 PM to 7 AM)", () => {
  it("late at night: Ron's words", () => {
    expect(quietHoursNotice(coach(21, 7), NY, nyAt("23:00"))).toBe("It's late. Your coach has quiet hours set. Expect a reply in the morning.");
    expect(quietHoursNotice(coach(21, 7), NY, nyAt("21:00"))).toBe("It's late. Your coach has quiet hours set. Expect a reply in the morning.");
  });
  it("after midnight, still inside: the same morning", () => {
    expect(quietHoursNotice(coach(21, 7), NY, nyAt("02:30", "2026-11-21"))).toBe("It's late. Your coach has quiet hours set. Expect a reply in the morning.");
  });
  it("early morning, inside but no longer late: no 'It's late'", () => {
    expect(quietHoursNotice(coach(21, 7), NY, nyAt("06:15", "2026-11-21"))).toBe("Your coach has quiet hours set. Expect a reply in the morning.");
  });
  it("outside the window: no line (the end hour itself is outside)", () => {
    expect(quietHoursNotice(coach(21, 7), NY, nyAt("07:00", "2026-11-21"))).toBeNull();
    expect(quietHoursNotice(coach(21, 7), NY, nyAt("14:00"))).toBeNull();
    expect(quietHoursNotice(coach(21, 7), NY, nyAt("20:59"))).toBeNull();
  });
  it("ends at the next 7:00 in the coach's own clock", () => {
    expect(quietEndsAt(coach(21, 7), nyAt("23:00"))?.toISOString()).toBe("2026-11-21T12:00:00.000Z");
  });
});

describe("a window that ends later in the day", () => {
  it("says when, in the client's time zone", () => {
    expect(quietHoursNotice(coach(13, 15), NY, nyAt("14:00"))).toBe("Your coach has quiet hours set. Expect a reply after 3:00 PM.");
  });
  it("a reply tomorrow afternoon says tomorrow", () => {
    expect(quietHoursNotice(coach(18, 13), NY, nyAt("19:00"))).toBe("Your coach has quiet hours set. Expect a reply after 1:00 PM tomorrow.");
  });
  it("a client in another time zone gets their own clock: the coach's 11 AM is 4 PM in London", () => {
    // 11 PM in New York is 4 AM in London: late there, and the reply comes that afternoon
    expect(quietHoursNotice(coach(22, 11), "Europe/London", nyAt("23:00"))).toBe("It's late. Your coach has quiet hours set. Expect a reply after 4:00 PM.");
  });
  it("the coach's 7 AM is 4 AM in Los Angeles: still the morning", () => {
    expect(quietHoursNotice(coach(21, 7), "America/Los_Angeles", nyAt("00:30", "2026-11-21"))).toBe("It's late. Your coach has quiet hours set. Expect a reply in the morning.");
  });
});

describe("no quiet hours", () => {
  it("none set, or the same hour for both, or an unreadable time zone: no line", () => {
    expect(quietHoursNotice(coach(null, null), NY, nyAt("23:00"))).toBeNull();
    expect(quietHoursNotice(coach(21, null), NY, nyAt("23:00"))).toBeNull();
    expect(quietHoursNotice(coach(21, 21), NY, nyAt("23:00"))).toBeNull();
    expect(quietHoursNotice(coach(21, 7, "Not/AZone"), NY, nyAt("23:00"))).toBeNull();
  });
  it("an unreadable client time zone falls back to the coach's", () => {
    expect(quietHoursNotice(coach(21, 7), "Nope/Zone", nyAt("23:00"))).toBe("It's late. Your coach has quiet hours set. Expect a reply in the morning.");
  });
});

describe("where it shows", () => {
  it("right after each kind of request a coach answers is sent, and nothing about notifying the coach changed", () => {
    expect(read("components/athlete/request-slot-button.tsx")).toContain("<QuietHoursNotice coachId={coachId}");
    expect(read("components/athlete/request-different-time.tsx")).toContain("<QuietHoursNotice coachId={coachId}");
    expect(read("components/athlete/reschedule-slot-button.tsx")).toContain("<QuietHoursNotice bookingId={bookingId}");
    expect(read("components/athlete/my-schedule.tsx")).toContain("{justSent && <QuietHoursNotice seriesId={series.id}");
    const flow = read("components/client-request/request-flow.tsx");
    expect(flow.match(/<QuietHoursNotice text=\{quietNotice\}/g)?.length).toBe(2);
    for (const route of ["app/api/client-requests/submit/route.ts", "app/api/client-requests/signup/route.ts"]) {
      expect(read(route)).toContain("coachQuietNotice(");
      // only the line goes back, never the hours
      expect(read(route)).not.toContain("quiet_hours_start");
    }
  });
});
