import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

// Live bug (Ron's phone): the "act as yourself" setting is a 12 hour cookie. When it ran out while his own training space was still open, the phone showed the coaching Home of that empty space
// ("Welcome. Two things get you started") instead of his own training. A coach's own personal space is now always his client app, as himself, with or without the cookie.
const read = (p: string) => readFileSync(join(__dirname, "..", p), "utf8").replace(/\r\n/g, "\n");
const acting = read("lib/acting-as.ts");
const home = read("components/coach/mobile/coach-mobile-home.tsx");

describe("a coach's own personal space on the phone", () => {
  it("always resolves as himself, without the 12 hour cookie", () => {
    expect(acting).toContain("isOwnPersonalSpace(groupId, realUserId)");
    expect(acting).toContain("organization_id === null");
    expect(acting).toContain("created_by === userId");
    expect(acting).toContain("return { athleteId: realUserId, realUserId, isActingAsOther: true }");
  });
  it("the first-run card is only for a coach with no clients anywhere", () => {
    expect(home).toContain("clientsElsewhere");
    // never "No clients" while the organization has some in its other groups: it says how many, with a way to them
    expect(home).not.toContain("No clients in {groupName}.");
    expect(home).toContain("in this organization.");
    expect(home).toContain("See your clients");
    expect(home).toContain("&& !clientsElsewhere &&");
  });
});

describe("Start workout on the coach's phone Home", () => {
  it("is pinned at the top, always, above every other card, and never replaced by the first-run card", () => {
    const start = home.indexOf("Start workout");
    expect(start).toBeGreaterThan(-1);
    expect(home).toContain('"/my-space?view=client"');
    expect(home).toContain("href={startHref}");
    expect(start).toBeLessThan(home.indexOf("<LateChangesPanel"));
    expect(start).toBeLessThan(home.indexOf("Welcome. Two things get you started"));
    expect(home.match(/Start workout/g)?.length).toBe(1);
  });
  it("says who is being logged for on the coach-logs-for-a-client bar", () => {
    const bar = read("components/coach/mobile/coach-mode-bar.tsx");
    expect(bar).toContain("Logging for {clientName}");
  });
});

describe("the phone Home's organization client count agrees with the Clients page", () => {
  it("counts each active client once and leaves out the ones set aside", () => {
    const home = readFileSync("components/coach/mobile/coach-mobile-home.tsx", "utf8").replace(/\r\n/g, "\n");
    expect(home).toContain("fetchInactiveKeys(supabase, others)");
    expect(home).toContain("!asideKeys.has(inactiveKey(m.group_id, m.profile_id))");
    expect(home).toContain(".map((m) => m.profile_id)).size");
    expect(home).not.toContain("countByIds");
  });
});
