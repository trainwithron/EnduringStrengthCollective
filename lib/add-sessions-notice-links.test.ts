import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { addSessionsHref, RUNNING_LOW_PATH } from "@/lib/add-sessions-link";
import { digestText } from "@/lib/low-session-digest";

const read = (p: string) => readFileSync(p, "utf8").replace(/\r\n/g, "\n");

// Ron, Oct 19: the notice that Cindie Downing was out of sessions "took me to a place that I can't add her sessions."
describe("the running-low notice opens the place sessions are added", () => {
  it("one client: the client's profile, Settings tab, scrolled to Assign sessions", () => {
    expect(addSessionsHref("g1", "a1")).toBe("/groups/g1/athletes/a1?tab=settings#add-sessions");
    const one = digestText([{ athleteId: "a1", groupId: "g1", name: "Cindie D.", balance: 0 }]);
    expect(one.url).toBe("/groups/g1/athletes/a1?tab=settings#add-sessions");
  });
  it("several clients: the Running low list, not the generic Clients list", () => {
    const many = digestText([{ athleteId: "a1", groupId: "g1", name: "Cindie D.", balance: 0 }, { athleteId: "a2", groupId: "g1", name: "Oliver B.", balance: 1 }]);
    expect(many.url).toBe(RUNNING_LOW_PATH);
    expect(RUNNING_LOW_PATH).toBe("/running-low");
  });
  it("the profile has the anchor on Add sessions, inside Billing right under the sentence (FIX 3)", () => {
    const profile = read("app/(coach)/groups/[groupId]/athletes/[athleteId]/page.tsx");
    const billing = profile.slice(profile.indexOf('<SettingsGroup label="Billing">'));
    expect(billing.indexOf("{sessionsSentence}")).toBeLessThan(billing.indexOf('<div id="add-sessions" className="scroll-mt-24 mb-4">'));
    expect(billing.indexOf('<div id="add-sessions"')).toBeLessThan(billing.indexOf("<SessionCreditsControl"));
    expect(profile).not.toContain('<SettingsGroup label="Assign sessions">');
  });
  it("every 'out of sessions' place goes straight to Add sessions, labelled so (FIX 3)", () => {
    const needs = read("lib/needs-you-data.ts");
    expect(needs).toContain("button: BUTTON.addSessions, href: addSessionsHref(p.groupId, p.athleteId), profileHref: clientPath(p.groupId, p.athleteId)");
    expect(read("lib/needs-you.ts")).toContain('addSessions: "Add sessions",');
    const day = read("lib/your-day.ts");
    expect(day).toContain('detail: "Add sessions",');
    expect(day).toContain("href: addSessionsHref(p.groupId, p.athleteId),");
    const panel = read("components/coach/desktop/needs-payment-panel.tsx");
    expect(panel).toContain("<Link prefetch={false} href={addSessionsHref(r.groupId, r.athleteId)} className=\"font-body text-xs text-chalk underline\">");
  });
  it("the list shows 1 left or none, leaves out payment holds and set-aside clients, and every row's button goes to the same place", () => {
    const page = read("app/(coach)/running-low/page.tsx");
    expect(page).toContain("x.credit.balance <= RUNNING_LOW_AT && !x.credit.hold && !setAside.has(inactiveKey(x.c.groupId, x.c.id))");
    expect(page).toContain("href={addSessionsHref(c.groupId, c.id)}");
    expect(page).toContain('"Out of sessions" : "1 session left"');
  });
});
