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

describe("adding sessions from the client's calendar tab", () => {
  it("the calendar tab shows the same sessions sentence and the same Add sessions control (compact)", () => {
    const cal = page.slice(page.indexOf('<div data-tab="calendar" className="mb-8">'), page.indexOf("<ClientCalendarSection"));
    expect(cal).toContain("<p className=\"font-body text-sm text-chalk lg:flex-1\">{sessionsSentence}</p>");
    expect(cal).toContain("<AssignSessionsControl");
    expect(cal).toContain("compact");
    expect(cal).toContain("key={`calendar-assign-${creditsRow?.balance ?? 0}`}");
    expect(cal).toContain("lg:flex-row");
    expect(cal).not.toContain('id="add-sessions"');
  });
  it("the Settings copy is unchanged and still the one the links point at; Billing shows the same sentence", () => {
    expect(page).toContain('<div data-tab="settings" id="add-sessions" className="scroll-mt-24">');
    const settings = page.slice(page.indexOf('id="add-sessions"'));
    expect(settings).toContain("key={`assign-${creditsRow?.balance ?? 0}`}");
    expect(page.match(/id="add-sessions"/g)?.length).toBe(1);
    expect(page).toContain('<p className="font-body text-sm text-chalk mb-3">{sessionsSentence}</p>');
  });
  it("compact: only the add row (no intro, no set-balance tools), labelled Add sessions; the full one is as before", () => {
    const props = { athleteId: "a", groupId: "g", clientName: "Sam", initialBalance: 3 };
    const compact = renderToStaticMarkup(createElement(AssignSessionsControl, { ...props, compact: true }));
    expect(compact).toContain("Add sessions");
    expect(compact).not.toContain("Set balance");
    expect(compact).not.toContain("without a purchase");
    const full = renderToStaticMarkup(createElement(AssignSessionsControl, props));
    expect(full).toContain("Assign sessions");
    expect(full).toContain("Set balance");
    expect(full).toContain("without a purchase");
  });
});
