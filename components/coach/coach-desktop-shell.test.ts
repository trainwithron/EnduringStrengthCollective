import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";

// The desktop rail is coach-level and short (Ron, Oct 6): Home keeps it, a client's group never becomes Home's anchor, the business name is a real menu,
// and the settings and help sit under Settings. Source-level guards so a later edit cannot bring the old behavior back.
const shell = readFileSync(new URL("./coach-desktop-shell.tsx", import.meta.url), "utf8").replace(/\r\n/g, "\n");
const dashboard = readFileSync(new URL("../../app/(coach)/dashboard/page.tsx", import.meta.url), "utf8");
const finder = readFileSync(new URL("./desktop/client-finder.tsx", import.meta.url), "utf8");
const homesLib = readFileSync(new URL("../../lib/desktop-coach-homes.ts", import.meta.url), "utf8").replace(/\r\n/g, "\n");

describe("coach desktop shell", () => {
  it("never remembers a one-on-one client group as the Home anchor", () => {
    expect(shell).toContain('groupKind === "one_on_one") return;');
    expect(shell).toContain("last_group=");
  });
  it("FIX 6: the rail is exactly the six homes, in order, and there are no menus", () => {
    expect(shell).toContain("const railIcons: RailIcon[] = HOMES.map((h) => ({");
    expect(shell).toContain("icons={railIcons}");
    expect(homesLib).toMatch(/export const HOMES[^=]*= \[\n  \{ key: "home", label: "Home" \},\n  \{ key: "clients", label: "Clients" \},\n  \{ key: "calendar", label: "Calendar" \},\n  \{ key: "programs", label: "Programs" \},\n  \{ key: "messages", label: "Messages" \},\n  \{ key: "settings", label: "Settings" \},\n\];/);
    for (const gone of ["ordinaryNav", "teamNav", "NavGroup", "FOLDED_HOMES", "sectionSubLinks", "More tools", 'label: "Coaching"', 'label: "Business"', 'label: "Group"']) expect(shell, gone).not.toContain(gone);
    // each icon goes to its home's first tab and is lit by the address (or, on a page outside the table, by the page's own key)
    expect(shell).toContain('href: homeHref(tabsByHome, h.key) ?? "/dashboard",');
    expect(shell).toContain("active: litHome === h.key,");
    // the hover widgets (decision 6): Business on Home where money shows, Feed under Messages, Team performance on Programs in a team-sport group only
    expect(shell).toContain("home: moneyHidden ? undefined : <BusinessRailWidget groupId={groupId} />,");
    expect(shell).toContain("programs: teamSport ? <TeamRailWidget groupId={groupId} /> : undefined,");
    expect(shell).toContain('{groupKind !== null && groupKind !== "one_on_one" && <FeedRailWidget groupId={groupId} />}');
    // the footer keeps only the workspace switcher, Report a problem, Download app and Sign out
    expect(shell).not.toContain('title="Display Mode"');
    expect(shell).not.toContain('title="Kiosk Check-In"');
    expect(shell).toContain("<FeedbackButton");
    expect(shell).toContain("<SignOutButton");
  });
  it("FIX 6: the Settings home holds Account, Display mode, Text messages, Support, Quick tips, Organization, Pro shop and referrals, My website, Zapier (and the team-sport Business link, and the admin pages)", () => {
    const settings = homesLib.slice(homesLib.indexOf("    settings: ["), homesLib.indexOf("  };\n  const out"));
    const order = ["Account", "Display mode", "Text messages", "Support", "Quick tips", "Organization", "Pro shop and referrals", "My website", "Zapier", "TEAM_SPORT_BUSINESS_LABEL", "Organizations", "Marketplace ranking"];
    let last = -1;
    for (const m of order) {
      const at = settings.indexOf(m);
      expect(at, m).toBeGreaterThan(last);
      last = at;
    }
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
  it("the Settings tab marks it newTab and the strip adds target=_blank", () => {
    expect(homesLib).toContain('{ key: "display", label: "Display mode", href: `${g}/display`, newTab: true }');
    const strip = readFileSync(new URL("./desktop/home-tab-strip.tsx", import.meta.url), "utf8");
    expect(strip).toContain('target: "_blank", rel: "noopener noreferrer"');
  });
});
