import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { ProgramDayPicker } from "@/components/shared/program-day-picker";

// From the live check of the one phone app (Oct 19): the program view was a dead end with only Back, /programs lit Home, and the install banner covered the Spotlight button.
const read = (p: string) => readFileSync(join(__dirname, "..", p), "utf8").replace(/\r\n/g, "\n");

describe("the phone program view is inside the coach's phone app", () => {
  const page = read("app/(coach)/groups/[groupId]/programs/[programId]/page.tsx");
  it("a real coach (not acting as a client) gets the bottom bar with More lit and the Spotlight button", () => {
    expect(page).toContain('const coachShell = membership.role === "coach" && !(await getEffectiveAthlete(params.groupId, user.id)).isActingAsOther;');
    expect(page).toContain('<CoachMobileShell groupId={params.groupId} groupName="" activeOverride="more">');
    expect(page).toContain("belowSpotlight={coachShell}");
  });
  it("a client, or a coach acting as one, keeps the plain view", () => {
    expect(page).toContain("return coachShell ? (");
    expect(page).toMatch(/\) : \(\n\s+view\n\s+\);/);
  });
  it("its header starts below the Spotlight button there", () => {
    const props = { title: "P", weeks: [], currentWeek: null, backHref: "/programs", editHref: null, workoutHrefBase: "/x", canEdit: false, isCoachViewing: false, nowIso: "2026-10-19T12:00:00Z" };
    expect(renderToStaticMarkup(createElement(ProgramDayPicker, { ...props, belowSpotlight: true }))).toContain('class="px-5 pt-16 pb-3"');
    expect(renderToStaticMarkup(createElement(ProgramDayPicker, props))).toContain('class="px-5 pt-8 pb-3"');
  });
  it("Programs lights More (it lives under More), and the coach bar can light More", () => {
    expect(read("app/(coach)/programs/page.tsx")).toContain('<CoachMobileShell groupId={anchor.id} groupName={anchor.name} activeOverride="more">');
    expect(read("components/coach/mobile/coach-mobile-shell.tsx")).toContain('activeOverride?: "home" | "roster" | "messages" | "calendar" | "more";');
  });
});

describe("the install banner never covers the Spotlight button", () => {
  const banner = read("components/add-to-home-screen-prompt.tsx");
  it("while the Spotlight button is on the page the banner starts below it (the button ends 52px down)", () => {
    expect(banner).toContain(`export const SPOTLIGHT_SELECTOR = 'button[aria-label="Spotlight"]';`);
    expect(banner).toContain("setSpotlightOn(!!document.querySelector(SPOTLIGHT_SELECTOR))");
    expect(banner).toContain('${spotlightOn ? "mt-14 border-t" : ""}');
    expect(read("components/coach/mobile/coach-spot-hub.tsx")).toContain('aria-label="Spotlight"');
    expect(read("components/coach/mobile/coach-spot-hub.tsx")).toContain('"top-3 h-10 w-10"');
  });
  it("keeps its close button", () => {
    expect(banner).toContain('aria-label="Dismiss"');
  });
});
