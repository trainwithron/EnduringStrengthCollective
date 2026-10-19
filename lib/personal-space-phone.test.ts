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
  it("the phone Home offers 'Add a client' only to a coach with no clients anywhere in the organization (never 'No clients' while some sit in its other groups)", () => {
    expect(home).toContain("let hasClients = (rosterRows ?? []).length > 0;");
    expect(home).toContain("const others = orgGroupIds.filter((id) => id !== groupId);");
    expect(home).not.toContain("No clients in {groupName}.");
    expect(home).toContain("{hasClients ? (");
    expect(home).toContain("Add a client");
  });
});

describe("the coach's phone Home is short", () => {
  it("has no start button for the coach's OWN workout (his own training is the 'Coach (you)' row at the top of the Clients list), no Desktop Mode button, no clients card, no quick actions, no business tiles", () => {
    expect(home).not.toContain("Start workout");
    expect(home).not.toContain('"/my-space?view=client"');
    expect(home).not.toContain("ViewModeToggle");
    expect(home).not.toContain("Quick actions");
    expect(home).not.toContain("SEE YOUR CLIENTS");
    expect(home).not.toContain("clients in this organization");
    expect(home).not.toContain("CoachHomeComplications");
    expect(home).not.toContain("NEEDS ATTENTION");
  });
  it("is the title, then the cards, then ONE button, then only what needs a decision", () => {
    const order = ["<h1", "<SessionCheckSection", "<NextClientWorkoutSection", "<LateChangesPanel"].map((s) => home.indexOf(s));
    expect(order.every((i) => i > -1)).toBe(true);
    expect([...order].sort((a, b) => a - b)).toEqual(order);
  });
  it("the title starts below the fixed Spotlight button, so it is never covered", () => {
    expect(home).toContain('className="px-5 pt-[108px] pb-4"');
  });
  it("the More sheet has Programs and Desktop mode, and the bottom bar has Home, Clients, Messages, Calendar, More", () => {
    const more = read("components/coach/mobile/coach-nav-links-list.tsx");
    expect(more).toContain('<Item href="/programs" label="Programs"');
    expect(more).toContain('<ViewModeToggle targetMode="desktop" label="Desktop mode"');
    const bar = read("components/athlete/bottom-tab-bar.tsx");
    for (const label of ['label: "Home"', 'term("client", "plural", { cap: true })', 'label: "Messages"', 'label: "Calendar"', 'label: "More"']) expect(bar).toContain(label);
  });
  it("says who is being logged for on the coach-logs-for-a-client bar", () => {
    const bar = read("components/coach/mobile/coach-mode-bar.tsx");
    expect(bar).toContain("Logging for {clientName}");
  });
});

describe("the phone Home's idea of 'has clients' agrees with the Clients page", () => {
  it("clients set aside do not count", () => {
    const home = readFileSync("components/coach/mobile/coach-mobile-home.tsx", "utf8").replace(/\r\n/g, "\n");
    expect(home).toContain("fetchInactiveKeys(supabase, others)");
    expect(home).toContain("!asideKeys.has(inactiveKey(m.group_id, m.profile_id))");
    expect(home).not.toContain("countByIds");
  });
});
