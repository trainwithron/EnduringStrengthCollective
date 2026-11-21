import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { vi } from "vitest";

vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: () => {}, push: () => {} }) }));
import { AssignSessionsControl } from "@/components/coach/assign-sessions-control";

// Ron, Oct 19: "To add a session to a client from their calendar ... it would be nice to be able to do it from the calendar also. That's where I'd be looking at it most likely."
const read = (p: string) => readFileSync(join(__dirname, "..", p), "utf8").replace(/\r\n/g, "\n");
const page = read("app/(coach)/groups/[groupId]/athletes/[athleteId]/page.tsx");

// Clutter pass, Nov 21 (DK24, PH21): ONE session control (the balance with - and +, and Add sessions), on Overview under Log their workout, at the top of Calendar (Ron, Oct 19)
// and first on Billing & settings.
describe("adding sessions from the client's calendar tab", () => {
  it("the calendar tab shows the same sessions sentence and the same session control", () => {
    const cal = page.slice(page.indexOf('<div data-tab="calendar" className="mb-8">'), page.indexOf("<ClientCalendarSection"));
    expect(cal).toContain("<p className=\"font-body text-sm text-chalk lg:flex-1\">{sessionsSentence}</p>");
    expect(cal).toContain('{sessionsControl("calendar")}');
    expect(cal).toContain("lg:flex-row");
    expect(cal).not.toContain('id="add-sessions"');
  });
});

describe("adding sessions on the client's profile", () => {
  it("one control: the balance with - and + and the compact Add sessions, side by side", () => {
    const control = page.slice(page.indexOf("const sessionsControl = ("), page.indexOf("// Where \"Back\" goes"));
    expect(control).toContain("<SessionCreditsControl");
    expect(control).toContain("<AssignSessionsControl");
    expect(control).toContain("compact");
    expect(control).toContain("key={`${where}-assign-${creditsRow?.balance ?? 0}`}");
    // nowhere else on the page
    expect(page.match(/<SessionCreditsControl/g)?.length).toBe(1);
    expect(page.match(/<AssignSessionsControl/g)?.length).toBe(1);
  });
  it("Overview shows the sentence and the control right under the tabs (Log their workout is just above on the phone)", () => {
    const overview = page.slice(page.indexOf("<ClientProfileTabs"), page.indexOf('<div data-tab="calendar" className="mb-8">'));
    expect(overview).toContain('data-tab="overview"');
    expect(overview).toContain("{sessionsSentence}");
    expect(overview).toContain('{sessionsControl("overview")}');
  });
  it("the Billing copy (FIX 3) is the one the links point at, and Billing is the first thing on its tab", () => {
    expect(page).toContain('<div id="add-sessions" className="scroll-mt-24 mb-4">');
    const settings = page.slice(page.indexOf('id="add-sessions"'));
    expect(settings.slice(0, 200)).toContain('{sessionsControl("billing")}');
    expect(page.match(/id="add-sessions"/g)?.length).toBe(1);
    expect(page).toContain('<p className="font-body text-sm text-chalk mb-3">{sessionsSentence}</p>');
    const grid = page.slice(page.indexOf('<div className="profile-grid'));
    const firstSettings = grid.indexOf('<div data-tab="settings"');
    expect(grid.slice(firstSettings, firstSettings + 120)).toContain("<SettingsGroup label=\"Billing\">");
    expect(grid.indexOf('<SettingsGroup label="Billing">')).toBeLessThan(grid.indexOf("<ClientNameControl"));
  });
  it("compact: only the add row (no intro), labelled Add sessions; the full one has the intro; neither has the set-balance tools (that is Billing's control, FIX 3)", () => {
    const props = { athleteId: "a", groupId: "g", clientName: "Sam", initialBalance: 3 };
    const compact = renderToStaticMarkup(createElement(AssignSessionsControl, { ...props, compact: true }));
    expect(compact).toContain("Add sessions");
    expect(compact).not.toContain("Set balance");
    expect(compact).not.toContain("without a purchase");
    const full = renderToStaticMarkup(createElement(AssignSessionsControl, props));
    expect(full).toContain("Add sessions");
    expect(full).not.toContain("Assign sessions");
    expect(full).not.toContain("Set balance");
    expect(full).toContain("without a purchase");
  });
});
