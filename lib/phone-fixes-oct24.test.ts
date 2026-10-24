import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { clientSessionLine, sessionStartsByAthlete } from "./client-session-line";
import { clientActivityStatus } from "./client-activity-status";

// Ron's phone use, Oct 24.
const read = (p: string) => readFileSync(join(__dirname, "..", p), "utf8").replace(/\r\n/g, "\n");
const LA = "America/Los_Angeles";
// Saturday Oct 24 2026, 10:00 AM in Los Angeles.
const NOW = new Date("2026-10-24T17:00:00Z");

describe("the wellness check-in is a card on the page, never a screen over it", () => {
  it("no full-screen overlay; Skip for today and Don't ask for a week stay", () => {
    const src = read("components/athlete/wellness-checkin-popup.tsx");
    expect(src).not.toContain("fixed inset-0");
    expect(src).toContain("data-wellness-card");
    expect(src).toContain("Skip for today");
    expect(src).toContain("Don&apos;t ask for a week");
    expect(read("app/(coach)/groups/[groupId]/page.tsx")).not.toMatch(/<WellnessCheckinPopup[^>]*\binline\b/);
  });
});

describe("Coaching staff does not list the coach looking at it", () => {
  it("the viewer is left out, and with nobody else the section is not drawn", () => {
    const src = read("components/group/roster-list.tsx");
    expect(src).toContain("const staffShown = coaches.filter((m) => m.profileId !== viewerId);");
    expect(src).toContain("staffShown.length > 0");
  });
});

describe("a client the coach trains in person shows their booked sessions, not 'hasn't started yet'", () => {
  it("the next session first, with the weekday inside a week and the date further out", () => {
    expect(clientSessionLine(["2026-10-19T16:00:00Z", "2026-10-27T17:00:00Z"], NOW, LA)).toBe("Next: Tue 10 AM");
    expect(clientSessionLine(["2026-10-27T17:30:00Z"], NOW, LA)).toBe("Next: Tue 10:30 AM");
    expect(clientSessionLine(["2026-11-10T18:00:00Z"], NOW, LA)).toBe("Next: Nov 10, 10 AM");
  });
  it("else the last one; nothing booked is null", () => {
    expect(clientSessionLine(["2026-10-21T16:00:00Z", "2026-10-19T16:00:00Z"], NOW, LA)).toBe("Last session Oct 21");
    expect(clientSessionLine([], NOW, LA)).toBeNull();
  });
  it("the line replaces 'New, hasn't started yet' only when they have never logged", () => {
    expect(clientActivityStatus(null, { isNew: true, sessionLine: "Last session Oct 21" }).text).toBe("Last session Oct 21");
    expect(clientActivityStatus(null, { isNew: true }).text).toBe("New, hasn't started yet");
    expect(clientActivityStatus(new Date().toISOString(), { sessionLine: "Next: Tue 10 AM" }).text).toBe("Logged today");
  });
  it("groups each client's sessions", () => {
    const m = sessionStartsByAthlete([{ athlete_id: "a", start_at: "x" }, { athlete_id: "a", start_at: "y" }, { athlete_id: "b", start_at: "z" }]);
    expect(m.get("a")).toEqual(["x", "y"]);
    expect(m.get("b")).toEqual(["z"]);
  });
  it("the phone Clients list reads confirmed bookings by group and passes the line; such a client is not flagged as quiet", () => {
    const page = read("app/(coach)/groups/[groupId]/clients/page.tsx");
    expect(page).toContain('.from("bookings")');
    expect(page).toContain('.eq("status", "confirmed")');
    expect(page).toContain("sessionLine: clientSessionLine(startsByAthlete.get(m.profileId) ?? [], sessionNow, viewerZone)");
    const roster = read("components/coach/mobile/coach-roster-mobile.tsx");
    expect(roster).toContain("sessionLine: member.sessionLine");
    expect(roster).toContain("(!m.lastWorkoutAt && m.sessionLine)");
  });
});

describe("Log their workout is the first thing under the client's name on the phone", () => {
  it("one primary button above the tabs, opening the Log page (which has Wing it); not on the computer or the coach's own space", () => {
    const page = read("app/(coach)/groups/[groupId]/athletes/[athleteId]/page.tsx");
    const button = page.indexOf("data-log-their-workout");
    expect(button).toBeGreaterThan(page.indexOf("<h1"));
    expect(button).toBeLessThan(page.indexOf("<ClientProfileTabs"));
    expect(page.match(/Log their workout\n/g)?.length).toBe(1);
    expect(page).toMatch(/\{!selfView && \(\n\s*<Link\n\s*href=\{`\/groups\/\$\{params\.groupId\}\/athletes\/\$\{params\.athleteId\}\/log`\}\n\s*className="lg:hidden mt-4 w-full min-h-12 flex items-center justify-center bg-rust/);
    expect(read("app/(coach)/groups/[groupId]/athletes/[athleteId]/log/page.tsx")).toContain("<WingItStartButton");
  });
});
