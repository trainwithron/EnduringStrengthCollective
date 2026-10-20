import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";

// The desktop rail is coach-level and short (Ron, Oct 6): Home keeps it, a client's group never becomes Home's anchor, the business name is a real menu,
// and the settings and help sit under Settings. Source-level guards so a later edit cannot bring the old behavior back.
const shell = readFileSync(new URL("./coach-desktop-shell.tsx", import.meta.url), "utf8");
const dashboard = readFileSync(new URL("../../app/(coach)/dashboard/page.tsx", import.meta.url), "utf8");
const finder = readFileSync(new URL("./desktop/client-finder.tsx", import.meta.url), "utf8");

describe("coach desktop shell", () => {
  it("never remembers a one-on-one client group as the Home anchor", () => {
    expect(shell).toContain('groupKind === "one_on_one") return;');
    expect(shell).toContain("last_group=");
  });
  it("the rail is Clients, Calendar, Messages, then the groups Coaching, Business, Group and Settings (no More tools)", () => {
    const navStart = shell.indexOf("const ordinaryNav: NavEntry[] = [");
    const navEnd = shell.indexOf("// The team-sport menu:");
    const nav = shell.slice(navStart, navEnd);
    const order = ['label: "Clients"', 'label: "Calendar"', 'label: "Messages"', 'label: "Coaching"', 'label: "Business"', 'label: "Group"', 'label: "Settings"'];
    let last = -1;
    for (const marker of order) {
      const at = nav.indexOf(marker);
      expect(at, marker).toBeGreaterThan(last);
      last = at;
    }
    expect(nav).not.toContain("More tools");
    expect(nav.indexOf('label: "Dashboard"')).toBe(-1);
    const at = (m: string) => nav.indexOf(m);
    // Coaching: Programs, Exercise Library, Nutrition
    for (const m of ['label: "Programs"', 'label: "Exercise library"', 'label: "Nutrition"']) {
      expect(at(m), m).toBeGreaterThan(at('label: "Coaching"'));
      expect(at(m), m).toBeLessThan(at('label: "Business"'));
    }
    // Business holds the business tools, Pro Shop and Referrals (the Resources page), and for the platform admin only Organizations and Marketplace ranking
    for (const m of ['label: "Booking page"', 'label: "Waiver"', 'label: "Leads"', 'label: "Session ledger"', 'label: "Organization (colors, team, plan)"', 'label: "Zapier"', 'label: "Pro shop and referrals"', 'label: "Marketplace ranking"']) {
      expect(at(m), m).toBeGreaterThan(at('label: "Business"'));
      expect(at(m), m).toBeLessThan(at('label: "Group"'));
    }
    expect(nav).toContain("...(isPlatformAdmin");
    // Group holds the group's own pages (Members first)
    const groupFirst = at('label: "Members"');
    expect(groupFirst).toBeGreaterThan(at('label: "Group"'));
    expect(groupFirst).toBeLessThan(at('label: "Group dashboard"'));
    for (const m of ['label: "Group dashboard"', 'label: "Team performance"', 'label: "Team feed"', 'label: "Group sessions"', 'label: "Challenges"', 'label: "Hall of fame"']) {
      expect(at(m), m).toBeGreaterThan(at('label: "Group"'));
      expect(at(m), m).toBeLessThan(at('label: "Settings"'));
    }
    // Settings: Account, Display Mode, Kiosk Check-In, Support, Quick Tips, and the Support Inbox for the platform admin only
    for (const m of ['label: "Account"', 'label: "Text messages"', 'label: "Display mode"', 'label: "Kiosk check-in"', 'label: "Support"', 'label: "Quick tips"', 'label: "Support inbox"']) expect(at(m), m).toBeGreaterThan(at('label: "Settings"'));
    // the footer keeps only the workspace switcher, Report a problem, Download app and Sign out
    expect(shell).not.toContain('title="Display Mode"');
    expect(shell).not.toContain('title="Kiosk Check-In"');
    expect(shell).toContain("<FeedbackButton");
    expect(shell).toContain("<SignOutButton");
    // Members is no longer a rail icon of its own
    expect(nav.indexOf('{ key: "members" as const, label: "Members"')).toBeGreaterThan(at('label: "Group"'));
  });
  it("the business name is a menu and a coach-level page shows it as the title", () => {
    expect(shell).toContain("<WorkspaceMenu");
    expect(shell).toContain("coachLevel");
  });
});

describe("Home", () => {
  it("anchors the rail on a real team or social group, or stays coach-level", () => {
    expect(dashboard).toContain('active="home" coachLevel');
    expect(dashboard).toContain('g.group_kind !== "one_on_one"');
  });
  it("never reads the last_group cookie for Home, so the rail is the same whatever the coach visited last", () => {
    const home = dashboard.slice(dashboard.indexOf("export default async function CoachHomePage"));
    const afterContent = home.slice(home.indexOf("let lastGroup"));
    expect(afterContent).not.toContain('get("last_group")');
    expect(afterContent).not.toContain("lastGroupCookie");
  });
});

describe("client finder wording", () => {
  it("uses the right article for the coach's own word", () => {
    expect(finder).toContain("withArticle(");
    expect(finder).not.toContain("`Find a ${clientWord");
  });
});

describe("Display Mode opens in a new tab", () => {
  it("the Settings list marks it newTab and the panel adds target=_blank", () => {
    expect(shell).toContain("icon: MonitorPlay, newTab: true");
    const panel = readFileSync(new URL("./desktop/shell-list-panel.tsx", import.meta.url), "utf8");
    expect(panel).toContain('target: "_blank", rel: "noopener noreferrer"');
  });
});
