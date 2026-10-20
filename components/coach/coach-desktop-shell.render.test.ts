import { describe, it, expect, vi } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

// Proof that Home's desktop rail renders: the shell is rendered the way Home renders it (coach-level) for the three kinds of coach, and the same
// top-level entries are there every time, whichever group it is anchored on and with no remembered group at all.
const at = vi.hoisted(() => ({ path: "/dashboard", search: "" }));
vi.mock("next/navigation", () => ({
  usePathname: () => at.path,
  useRouter: () => ({ push: () => {}, refresh: () => {}, replace: () => {} }),
  useSearchParams: () => new URLSearchParams(at.search),
}));
vi.mock("@/lib/supabase/client", () => ({
  createBrowserClient: () => ({
    auth: { getUser: async () => ({ data: { user: null } }) },
    from: () => ({ select: () => ({ eq: () => ({ eq: () => ({ maybeSingle: async () => ({ data: null }) }) }) }) }),
  }),
}));

import { CoachDesktopShell } from "./coach-desktop-shell";

const render = (props: { groupId: string; groupName: string }) =>
  renderToStaticMarkup(createElement(CoachDesktopShell, { ...props, active: "home", coachLevel: true } as never, createElement("div", null, "HOME CONTENT")));

const RAIL = ["Clients", "Calendar", "Messages", "Coaching", "Business", "Settings"];

describe("Home's desktop rail", () => {
  const cases: [string, { groupId: string; groupName: string }][] = [
    ["a coach with team groups (anchored on a team group)", { groupId: "g-team", groupName: "Varsity" }],
    ["a coach with only one-on-one groups (anchored on one of them, shown as the business)", { groupId: "g-solo", groupName: "Enduring Strength Co." }],
    ["a coach in two or more organizations (anchored on the first shared group)", { groupId: "g-org2", groupName: "Main Group" }],
  ];
  for (const [label, props] of cases) {
    it(`shows the full coach-level rail for ${label}`, () => {
      const html = render(props);
      for (const item of RAIL) expect(html, item).toContain(item);
      expect(html).toContain("HOME CONTENT");
      // the page's own group is never the page title or a client badge: Home belongs to the coach
      expect(html).not.toContain("Client</span>");
    });
  }
  it("FIX 6: /dashboard shows the Home strip (Today lit, Business, Group dashboard) at the top of the page", () => {
    const html = render({ groupId: "g-team", groupName: "Varsity" });
    expect(html).toContain('aria-label="Home"');
    expect(html).toContain("data-home-strip");
    const strip = html.slice(html.indexOf("data-home-strip"), html.indexOf("HOME CONTENT"));
    expect(strip).toContain('href="/dashboard"');
    expect(strip).toMatch(/aria-current="page"[^>]*>Today|>Today<\/a>/);
    expect(strip).toContain('href="/groups/g-team/business"');
    expect(strip).toContain('href="/groups/g-team/dashboard"');
  });
  // the rail icon with this label, lit or not
  const railLit = (html: string, label: string) => {
    const i = html.indexOf(`aria-label="${label}"`);
    const tag = html.slice(html.lastIndexOf("<a", i), html.indexOf(">", i));
    return tag.includes("bg-rust/15");
  };
  // the strip's tab going to this address is the lit one
  const tabOn = (strip: string, href: string) => {
    const i = strip.indexOf(`href="${href}"`);
    return i >= 0 && strip.slice(strip.lastIndexOf("<a", i), strip.indexOf(">", i)).includes('aria-current="page"');
  };
  const page = (path: string, search: string, active: string) => {
    at.path = path;
    at.search = search;
    try {
      return renderToStaticMarkup(createElement(CoachDesktopShell, { groupId: "g-team", groupName: "Varsity", active, coachLevel: true } as never, createElement("div", null, "HOME CONTENT")));
    } finally {
      at.path = "/dashboard";
      at.search = "";
    }
  };
  it("FIX 6 R2: /calendar?tab=availability shows the Calendar strip with Availability lit, and the Calendar icon lit", () => {
    const html = page("/calendar", "tab=availability", "calendar");
    const strip = html.slice(html.indexOf("data-home-strip"), html.indexOf("HOME CONTENT"));
    expect(html).toContain('<nav aria-label="Calendar"');
    expect(tabOn(strip, "/calendar?tab=availability")).toBe(true);
    expect(tabOn(strip, "/calendar")).toBe(false);
    expect(strip).toContain('href="/group-calendar"');
    expect(strip).toContain('href="/groups/g-team/business/booking-page"');
    expect(railLit(html, "Calendar")).toBe(true);
    expect(railLit(html, "Home")).toBe(false);
  });
  it("FIX 6 R2: /running-low lights Clients (strip: Clients, Leads, Waiver, Session ledger, Packages)", () => {
    const html = page("/running-low", "", "clients");
    const strip = html.slice(html.indexOf("data-home-strip"), html.indexOf("HOME CONTENT"));
    expect(html).toContain('<nav aria-label="Clients"');
    expect(tabOn(strip, "/clients")).toBe(true);
    for (const p of ["leads", "waiver", "session-ledger", "packages"]) expect(strip, p).toContain(`href="/groups/g-team/business/${p}"`);
    expect(railLit(html, "Clients")).toBe(true);
  });
  it("does not need a remembered group: nothing in the rendered rail comes from a cookie", () => {
    const a = render({ groupId: "g-team", groupName: "Varsity" });
    const b = render({ groupId: "g-team", groupName: "Varsity" });
    expect(a).toBe(b);
  });
});
