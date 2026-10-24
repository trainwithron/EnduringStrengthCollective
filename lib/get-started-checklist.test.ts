import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { getStartedSteps, hiddenForClient, hideForClient, HIDE_GET_STARTED_KEY, showGetStarted, SIGN_IN_OPTIONS_ANCHOR, type GetStartedFacts } from "./get-started-checklist";
import { GetStartedList } from "@/components/coach/get-started-card";

// Ron, Oct 24: a coach checklist on a new client's profile — "Sure, but it needs to be easily dismissible. Some people have a different workflow."
const read = (p: string) => readFileSync(join(__dirname, "..", p), "utf8").replace(/\r\n/g, "\n");
const none: GetStartedFacts = { hasProgram: false, hasSessions: false, onCalendar: false, signInSent: false };
const all: GetStartedFacts = { hasProgram: true, hasSessions: true, onCalendar: true, signInSent: true };
const base = { selfView: false, loggedWorkouts: 0, hiddenForAll: false };

function memoryStore() {
  const m = new Map<string, string>();
  return { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => void m.set(k, v) };
}

describe("each step ticks itself from real data and links to where it is done", () => {
  it("the four steps, in order, each with its place", () => {
    const steps = getStartedSteps(none, "g", "a");
    expect(steps.map((s) => s.label)).toEqual(["Assign a program", "Add sessions", "Put them on the calendar", "Send their sign-in link"]);
    expect(steps.map((s) => s.href)).toEqual([
      "/groups/g/athletes/a?tab=program",
      "/groups/g/athletes/a?tab=settings#add-sessions",
      "/groups/g/calendar?client=a&scheduleFor=a",
      `/groups/g/athletes/a?tab=settings#${SIGN_IN_OPTIONS_ANCHOR}`,
    ]);
  });
  for (const key of ["hasProgram", "hasSessions", "onCalendar", "signInSent"] as const) {
    it(`${key} ticks exactly its own step`, () => {
      const steps = getStartedSteps({ ...none, [key]: true }, "g", "a");
      expect(steps.filter((s) => s.done)).toHaveLength(1);
      const html = renderToStaticMarkup(createElement(GetStartedList, { firstName: "Cindie", steps }));
      expect(html.match(/data-step-done=/g)?.length).toBe(1);
      expect(html.match(/data-step-open=/g)?.length).toBe(3);
    });
  }
  it("the card names the client and offers × and Don't show", () => {
    const html = renderToStaticMarkup(createElement(GetStartedList, { firstName: "Cindie", steps: getStartedSteps(none, "g", "a") }));
    expect(html).toContain("Get Cindie started");
    expect(html).toContain('aria-label="Hide for Cindie"');
    expect(html).toContain("Don&#x27;t show for new clients");
  });
  it("the profile reads each step from what the page already has", () => {
    const page = read("app/(coach)/groups/[groupId]/athletes/[athleteId]/page.tsx");
    expect(page).toContain("hasProgram: !!activeProgram,");
    expect(page).toContain("hasSessions: (creditsRow?.balance ?? 0) > 0 || (!ledgerAll.failed && (ledgerSums.bought ?? 0) > 0) || assignedPackageIds.length > 0,");
    expect(page).toContain("onCalendar: (profileCounts?.booked ?? 0) > 0,");
    expect(page).toContain('signInSent: signInStatus === "active" || !!latestInviteRow,');
    expect(page).toContain('id={SIGN_IN_OPTIONS_ANCHOR} className="scroll-mt-24"');
    // above the tabs, so it is at the top on every tab, computer and phone
    expect(page.indexOf("<GetStartedCard")).toBeLessThan(page.indexOf("<ClientProfileTabs"));
    expect(page.indexOf("<GetStartedCard")).toBeGreaterThan(page.indexOf("<h1"));
  });
});

describe("easily dismissed", () => {
  it("× hides it for that client only", () => {
    const store = memoryStore();
    expect(hiddenForClient(store, "a")).toBe(false);
    hideForClient(store, "a");
    expect(hiddenForClient(store, "a")).toBe(true);
    expect(hiddenForClient(store, "b")).toBe(false);
    // a browser that cannot store just shows it
    expect(hiddenForClient(null, "a")).toBe(false);
    expect(hiddenForClient({ getItem: () => { throw new Error("blocked"); }, setItem: () => {} }, "a")).toBe(false);
  });
  it("Don't show hides it for every client (saved on the coach's account)", () => {
    expect(showGetStarted({ ...base, steps: getStartedSteps(none, "g", "a") })).toBe(true);
    expect(showGetStarted({ ...base, hiddenForAll: true, steps: getStartedSteps(none, "g", "a") })).toBe(false);
    expect(read("components/coach/get-started-card.tsx")).toContain("auth.updateUser({ data: { [HIDE_GET_STARTED_KEY]: true } })");
    expect(read("app/(coach)/groups/[groupId]/athletes/[athleteId]/page.tsx")).toContain("hiddenForAll: user.user_metadata?.[HIDE_GET_STARTED_KEY] === true,");
    expect(HIDE_GET_STARTED_KEY).toBe("hide_get_started_checklist");
  });
});

describe("goes away by itself", () => {
  it("when all four are done", () => {
    expect(showGetStarted({ ...base, steps: getStartedSteps(all, "g", "a") })).toBe(false);
    expect(showGetStarted({ ...base, steps: getStartedSteps({ ...all, signInSent: false }, "g", "a") })).toBe(true);
  });
  it("never for a client who already logs workouts, and never on the coach's own space", () => {
    expect(showGetStarted({ ...base, loggedWorkouts: 1, steps: getStartedSteps(none, "g", "a") })).toBe(false);
    expect(showGetStarted({ ...base, selfView: true, steps: getStartedSteps(none, "g", "a") })).toBe(false);
  });
});
