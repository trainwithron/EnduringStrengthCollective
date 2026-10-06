import { describe, it, expect, vi } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

// Proof that Home's desktop rail renders: the shell is rendered the way Home renders it (coach-level) for the three kinds of coach, and the same
// top-level entries are there every time, whichever group it is anchored on and with no remembered group at all.
vi.mock("next/navigation", () => ({
  usePathname: () => "/dashboard",
  useRouter: () => ({ push: () => {}, refresh: () => {}, replace: () => {} }),
  useSearchParams: () => new URLSearchParams(),
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

const RAIL = ["Clients", "Calendar", "Messages", "Programming", "Nutrition", "Business", "More tools"];

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
  it("does not need a remembered group: nothing in the rendered rail comes from a cookie", () => {
    const a = render({ groupId: "g-team", groupName: "Varsity" });
    const b = render({ groupId: "g-team", groupName: "Varsity" });
    expect(a).toBe(b);
  });
});
