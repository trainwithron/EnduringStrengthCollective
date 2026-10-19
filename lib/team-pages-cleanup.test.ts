import { readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

vi.mock("next/navigation", () => ({ usePathname: () => "/clients", useRouter: () => ({ push: () => {}, refresh: () => {}, replace: () => {} }), useSearchParams: () => new URLSearchParams() }));

import { CoachClientsList } from "@/components/coach/desktop/coach-clients-list";
import { YourDayPanel } from "@/components/coach/desktop/your-day-panel";

const read = (p: string) => readFileSync(p, "utf8").replace(/\r\n/g, "\n");

describe("a phone coach's Programs is the simple cards, from every link", () => {
  it("no phone link goes to the desktop group programs page, and that page sends a phone to /programs", () => {
    expect(read("components/coach/mobile/coach-mobile-home.tsx")).not.toContain("href={`/groups/${groupId}/programs`}");
    expect(read("components/coach/mobile/coach-mobile-home.tsx")).toContain('href="/programs"');
    expect(read("components/shared/program-plain-view-server.tsx")).toContain('isCoach ? "/programs"');
    const group = read("app/(coach)/groups/[groupId]/programs/page.tsx");
    expect(group).toContain('if (await prefersAthleteStyleView()) redirect("/programs");');
    expect(group.indexOf("prefersAthleteStyleView()")).toBeGreaterThan(group.indexOf('membership?.role !== "coach"'));
  });
  it("/programs on a phone is the simple list, ahead of the desktop shell", () => {
    const page = read("app/(coach)/programs/page.tsx");
    expect(page.indexOf("<ProgramsPhoneList")).toBeLessThan(page.indexOf("<ProgramsList "));
  });
});

describe("the desktop Clients page for a team organization with ZERO athletes", () => {
  it("is decided by the organization's type, not by the client list", () => {
    const page = read("app/(coach)/clients/page.tsx");
    expect(page).toContain("orgIsTeamOnly((orgGroupRows.data ?? [])");
    expect(page).toContain("const oneView = orgTeamOnly || clientsAllInTeams;");
  });
  it("shows no 1-on-1 / Online / Group filters, no Cards/List toggle, no sessions footnote, and says 'No athletes yet. Add one to get started.'", () => {
    const html = renderToStaticMarkup(createElement(CoachClientsList, { rows: [], oneView: true }));
    expect(html).toContain("No athletes yet. Add one to get started.");
    expect(html).not.toMatch(/1-on-1|In person|Online|Set aside|Cards|sessions are left to schedule|No clients yet/);
    expect(html).toContain("Search athletes");
  });
  it("an ordinary coach's empty list is unchanged", () => {
    const html = renderToStaticMarkup(createElement(CoachClientsList, { rows: [], oneView: false }));
    expect(html).toContain("No clients yet.");
    expect(html).toContain("In person");
  });
});

describe("desktop Home for a team organization", () => {
  const page = read("app/(coach)/dashboard/page.tsx");
  it("drops the 1-on-1 / athlete / group pulse tabs, the athlete counts, the 'invite your first client' lines and the getting-started card", () => {
    expect(page).toContain("{!moneyHidden && (\n        <div className=\"mb-6\">\n          <PulseTabs");
    expect(page).toContain("{!moneyHidden && (\n      <DashboardTileGrid");
    expect(page).toContain("{!moneyHidden && clientCards.length === 0");
  });
  it("keeps the team tiles, the coach profile card and Your day", () => {
    expect(page).toContain("<TeamCoachHome");
    expect(page).toContain("<CoachProfileEditor");
    expect(page).toContain("<YourDayPanel");
  });
  it("Your day says nothing about payments for a team organization, and still does for everyone else", () => {
    expect(page).toContain("showPayments={!moneyHidden}");
    const props = { schedule: [], attention: [], timezone: "America/Los_Angeles" };
    const team = renderToStaticMarkup(createElement(YourDayPanel, { ...props, showPayments: false }));
    expect(team).toContain("Replies and check-ins that need you will show up here.");
    expect(team).not.toMatch(/payment/i);
    expect(renderToStaticMarkup(createElement(YourDayPanel, props))).toContain("Replies, payments and check-ins");
  });
});
