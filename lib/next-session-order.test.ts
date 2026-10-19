import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { nextSessionLabel, nextSessionStart, orderByNextSession } from "@/lib/next-session-order";

const read = (p: string) => readFileSync(p, "utf8").replace(/\r\n/g, "\n");
const LA = "America/Los_Angeles";
// Monday Oct 19, 2026, 7:55 AM Pacific (PDT, UTC-7).
const NOW = new Date("2026-10-19T14:55:00Z");
const at = (iso: string) => iso;

interface C {
  name: string;
  next: string | null;
}
const order = (clients: C[], now = NOW) => orderByNextSession(clients, { nextOf: (c) => c.next, nameOf: (c) => c.name, timezone: LA, now }).map((c) => c.name);

// Ron, Oct 19: "If it's 7:55 and I pull up the list it should put my 8 at the top of the list."
describe("the Clients list in the Spotlight overlay is ordered by who is coming up", () => {
  it("at 7:55 the 8:00 client is on top, then the later ones today, then later days, then everyone else A to Z", () => {
    const clients: C[] = [
      { name: "Zed (no session)", next: null },
      { name: "Brendan (Wed)", next: at("2026-10-21T17:00:00Z") },
      { name: "Hewan (today 5 PM)", next: at("2026-10-20T00:00:00Z") }, // 5:00 PM PDT today
      { name: "Karina (today 8 AM)", next: at("2026-10-19T15:00:00Z") },
      { name: "Amber (no session)", next: null },
      { name: "Cindie (tomorrow)", next: at("2026-10-20T16:00:00Z") },
      { name: "Oliver (today 9 AM)", next: at("2026-10-19T16:00:00Z") },
    ];
    expect(order(clients)).toEqual(["Karina (today 8 AM)", "Oliver (today 9 AM)", "Hewan (today 5 PM)", "Cindie (tomorrow)", "Brendan (Wed)", "Amber (no session)", "Zed (no session)"]);
  });
  it("a session that started in the last 30 minutes and is not finished stays at the top, ahead of the 8:00", () => {
    const clients: C[] = [
      { name: "Karina (8:00)", next: at("2026-10-19T15:00:00Z") },
      { name: "Jackson (began 7:35)", next: nextSessionStart(["2026-10-19T14:35:00Z"], NOW) },
    ];
    expect(order(clients)).toEqual(["Jackson (began 7:35)", "Karina (8:00)"]);
  });
  it("one that began more than 30 minutes ago is no longer 'next': the client's following session counts instead", () => {
    expect(nextSessionStart(["2026-10-19T14:20:00Z", "2026-10-21T17:00:00Z"], NOW)).toBe("2026-10-21T17:00:00Z");
    expect(nextSessionStart(["2026-10-19T14:20:00Z"], NOW)).toBeNull();
    expect(nextSessionStart(["2026-10-19T15:00:00Z", "2026-10-19T14:40:00Z"], NOW)).toBe("2026-10-19T14:40:00Z");
    expect(nextSessionStart([], NOW)).toBeNull();
  });
  it("'today' is the coach's day, not UTC's: at 6 PM Pacific a 7:30 PM session is today, a 5:30 PM one tomorrow morning is not", () => {
    const evening = new Date("2026-10-20T01:00:00Z"); // 6:00 PM PDT Oct 19
    const clients: C[] = [
      { name: "Tomorrow morning", next: "2026-10-20T16:30:00Z" },
      { name: "Tonight 7:30", next: "2026-10-20T02:30:00Z" },
    ];
    expect(order(clients, evening)).toEqual(["Tonight 7:30", "Tomorrow morning"]);
  });
  it("two with no session sort A to Z, and equal times sort by name", () => {
    expect(order([{ name: "Zoe", next: null }, { name: "Abe", next: null }])).toEqual(["Abe", "Zoe"]);
    expect(order([{ name: "Zoe", next: "2026-10-19T15:00:00Z" }, { name: "Abe", next: "2026-10-19T15:00:00Z" }])).toEqual(["Abe", "Zoe"]);
  });
});

describe("the small grey time under the name", () => {
  it("Today, Tomorrow, then the day, on the coach's clock", () => {
    expect(nextSessionLabel("2026-10-19T15:00:00Z", LA, NOW)).toBe("Today 8:00 AM");
    expect(nextSessionLabel("2026-10-20T16:30:00Z", LA, NOW)).toBe("Tomorrow 9:30 AM");
    expect(nextSessionLabel("2026-10-21T17:00:00Z", LA, NOW)).toBe("Wed, Oct 21 10:00 AM");
    expect(nextSessionLabel("2026-10-20T00:00:00Z", LA, NOW)).toBe("Today 5:00 PM");
  });
});

describe("the Spotlight overlay's Clients panel", () => {
  const panel = read("components/coach/mobile/spot-clients-groups-panel.tsx");
  const loader = read("lib/coach-client-list.ts");
  it("shows the full name, wrapping rather than cutting it, and the next session time under it", () => {
    expect(panel).toContain("break-words");
    expect(panel).not.toMatch(/truncate[^"]*">\{c\.fullName\}/);
    expect(panel).toContain("nextSessionLabel(c.nextStartIso");
  });
  it("has no check-in or 'gone quiet' lines and no sessions-left number", () => {
    for (const gone of ["clientActivityStatus", "computeQuietTier", "QUIET_TIER_LABEL", "gone quiet", "check-in", "left to schedule", "buildCreditPicture"]) expect(panel, gone).not.toContain(gone);
  });
  it("is the calendar's list: the same clients, the same in-person default and the same remembered 'Show online clients' switch", () => {
    expect(panel).toContain("loadCoachClientList(");
    expect(panel).toContain("offeredForBooking(");
    expect(panel).toContain("useShowOnlineClients()");
    expect(panel).toContain("orderByNextSession(");
    expect(loader).toContain("getCoachClients(");
  });
  it("reads only this coach's confirmed, not yet marked sessions in the listed organization's groups, half an hour back to six weeks ahead", () => {
    expect(loader).toContain('.in("group_id", g)');
    expect(loader).toContain('.eq("coach_id", coachId)');
    expect(loader).toContain('.eq("status", "confirmed")');
    expect(loader).toContain('.is("attended_at", null)');
  });
  it("keeps the three buttons", () => {
    for (const label of ["Log their workout", "Profile", "View as client"]) expect(panel).toContain(label);
  });
});
