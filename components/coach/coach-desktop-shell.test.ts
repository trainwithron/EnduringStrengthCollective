import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";

// The desktop rail is coach-level and short (Ron, Oct 6): Home keeps it, a client's group never becomes Home's anchor, the business name is a real menu,
// and the settings and help sit under Settings. Source-level guards so a later edit cannot bring the old behavior back.
const shell = readFileSync(new URL("./coach-desktop-shell.tsx", import.meta.url), "utf8").replace(/\r\n/g, "\n");
const dashboard = readFileSync(new URL("../../app/(coach)/dashboard/page.tsx", import.meta.url), "utf8");
const finder = readFileSync(new URL("./desktop/client-finder.tsx", import.meta.url), "utf8");

describe("coach desktop shell", () => {
  it("never remembers a one-on-one client group as the Home anchor", () => {
    expect(shell).toContain('groupKind === "one_on_one") return;');
    expect(shell).toContain("last_group=");
  });
  it("the rail is Clients, Calendar, Programs, Messages, then the Business and Settings menus (FIX 6 R3: no Coaching or Group menu)", () => {
    const navStart = shell.indexOf("const ordinaryNav: NavEntry[] = [");
    const navEnd = shell.indexOf("// The team-sport menu:");
    const nav = shell.slice(navStart, navEnd);
    const order = ['label: "Clients"', 'label: "Calendar"', "programsLeaf,", 'label: "Messages"', 'label: "Business"', 'label: "Settings"'];
    let last = -1;
    for (const marker of order) {
      const at = nav.indexOf(marker);
      expect(at, marker).toBeGreaterThan(last);
      last = at;
    }
    expect(nav).not.toContain("More tools");
    expect(nav.indexOf('label: "Dashboard"')).toBe(-1);
    const at = (m: string) => nav.indexOf(m);
    expect(shell).toContain('const programsLeaf: NavLeaf = { key: "programs", label: "Programs", href: ALL_PROGRAMS_HREF, icon: Dumbbell, termKey: "program", termForm: "plural" };');
    // Gone from the menus: each is a tab of its home now (lib/desktop-coach-homes.ts)
    const moved = [
      // Home, Messages (R1)
      "Group dashboard", "Team feed", "Overview", "Support inbox",
      // Clients, Calendar (R2)
      "Packages", "Booking page", "Waiver", "Leads", "Session ledger", "Availability", "Session types", "Members", "Attendance", "Team calendar", "Group calendar", "Group sessions", "Kiosk check-in", "Front desk",
      // Programs (R3)
      "Coaching", "Group", "Exercise library", "Nutrition", "Team performance", "Depth chart", "Seasons", "Challenges", "Hall of fame",
    ];
    for (const m of moved) expect(nav, m).not.toContain(`label: "${m}"`);
    // Business holds Pro Shop and Referrals (the Resources page), My website, Organization, Zapier, and for the platform admin only Organizations and Marketplace ranking.
    for (const m of ['label: "Organization (colors, team, plan)"', 'label: "Zapier"', 'label: "Pro shop and referrals"', 'label: "Marketplace ranking"']) {
      expect(at(m), m).toBeGreaterThan(at('label: "Business"'));
      expect(at(m), m).toBeLessThan(at('label: "Settings"'));
    }
    expect(nav).toContain("...(isPlatformAdmin");
    // Settings: Account, Display Mode, Text messages, Support, Quick Tips
    for (const m of ['label: "Account"', 'label: "Text messages"', 'label: "Display mode"', 'label: "Support"', 'label: "Quick tips"']) expect(at(m), m).toBeGreaterThan(at('label: "Settings"'));
    // the footer keeps only the workspace switcher, Report a problem, Download app and Sign out
    expect(shell).not.toContain('title="Display Mode"');
    expect(shell).not.toContain('title="Kiosk Check-In"');
    expect(shell).toContain("<FeedbackButton");
    expect(shell).toContain("<SignOutButton");
    // The Clients, Calendar, Programs and Messages icons (and a team-sport group's Athletes and Team calendar) go to their home's first tab and are lit by the address
    expect(shell).toContain('const LEAF_HOME: Partial<Record<string, HomeKey>> = { clients: "clients", members: "clients", calendar: "calendar", "team-calendar": "calendar", programs: "programs", messages: "messages" };');
    expect(shell).toContain('new Set<HomeKey>(["home", "clients", "calendar", "programs", "messages"])');
  });
  it("FIX 6 R3: a team-sport group's rail is Athletes, Team calendar, Programs, Messages, Settings, and its Programs icon carries the Team performance widget", () => {
    const team = shell.slice(shell.indexOf("// The team-sport menu:"), shell.indexOf("const nav: NavEntry[] = teamSport"));
    expect(team).toContain('const teamIcons: Record<string, typeof LayoutGrid> = {\n    members: Users2,\n    "team-calendar": CalendarDays,\n    messages: Mail,\n  };');
    expect(team).toContain("teamSportMenu(groupId).filter((item) => item.key in teamIcons)");
    expect(team).toContain('...teamLeaves.filter((l) => l.key !== "messages"),\n    programsLeaf,\n    ...teamLeaves.filter((l) => l.key === "messages"),');
    expect(team).not.toContain('label: "More"');
    expect(shell).toContain("...(teamSport ? { programs: <TeamRailWidget groupId={groupId} /> } : {}),");
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
