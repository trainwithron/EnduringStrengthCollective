import { describe, it, expect } from "vitest";
import { readdirSync, statSync, readFileSync } from "node:fs";
import { join, relative, sep } from "node:path";
import { homeOfPath, homeTabs, homeHref, HOMES, DESKTOP_EXCLUDED, type HomeFacts, type HomeKey } from "./desktop-coach-homes";

// FIX 6: six homes on the computer. The route table is checked against every page on disk, every tab against the table, and every destination of the old menus against the tabs.
const root = join(__dirname, "..");
const G = "11111111-1111-4111-8111-111111111111";
const ID = "22222222-2222-4222-8222-222222222222";
const sample = (route: string) => route.replace("[groupId]", G).replace(/\[[^\]]+\]/g, ID);

function pagesUnder(dir: string, prefix: string): string[] {
  const base = join(root, dir);
  const walk = (d: string): string[] => readdirSync(d).flatMap((n) => (statSync(join(d, n)).isDirectory() ? walk(join(d, n)) : n === "page.tsx" ? [d] : []));
  return walk(base).map((d) => prefix + ("/" + relative(base, d).split(sep).join("/")).replace(/\/$/, "")).map((r) => (r === "" ? "/" : r));
}
const coachPages = pagesUnder("app/(coach)", "");
const outsidePages = [...pagesUnder("app/admin", "/admin"), "/notifications", "/front-desk", "/reports"];

const ordinary: HomeFacts = { groupId: G, coachLevel: false, groupKind: "team", teamMode: false, teamSport: false, moneyHidden: false, navFacts: null, isPlatformAdmin: false, onFrontDesk: false };
const everything: HomeFacts = { ...ordinary, teamMode: true, isPlatformAdmin: true, onFrontDesk: true };

describe("every page is in exactly one home, or deliberately in none", () => {
  it("finds the pages", () => {
    expect(coachPages.length).toBeGreaterThan(80);
    expect(outsidePages).toContain("/admin/support");
  });
  for (const route of [...coachPages, ...outsidePages]) {
    it(route, () => {
      const at = homeOfPath(sample(route));
      const excluded = DESKTOP_EXCLUDED.includes(route);
      expect(excluded || at !== null, `${route}: add it to the table in lib/desktop-coach-homes.ts or to DESKTOP_EXCLUDED`).toBe(true);
      expect(excluded && at !== null, `${route} is both in a home and excluded`).toBe(false);
    });
  }
  it("every excluded route is a real page", () => {
    for (const r of DESKTOP_EXCLUDED) expect(coachPages, r).toContain(r);
  });
});

describe("every tab lands back on itself", () => {
  const variants: [string, HomeFacts][] = [
    ["ordinary team group", everything],
    ["coach-level page", { ...everything, coachLevel: true }],
    ["team-sport group", { ...everything, teamSport: true, teamMode: true, moneyHidden: true }],
    ["one-on-one space", { ...everything, groupKind: "one_on_one", teamMode: false }],
  ];
  // the one deliberate cross-link: a team-sport group's quiet Business link in Settings opens Home > Business
  const crossLinks = new Set(["business-tools"]);
  for (const [label, facts] of variants) {
    it(label, () => {
      const tabs = homeTabs(facts);
      for (const h of HOMES) {
        for (const t of tabs[h.key]) {
          if (crossLinks.has(t.key)) continue;
          const [path, query] = t.href.split("?");
          expect(homeOfPath(path, query ? `?${query}` : ""), `${h.key} > ${t.label} (${t.href})`).toEqual({ home: h.key, tab: t.key });
        }
      }
    });
  }
});

describe("today's menus all have a place", () => {
  // Every destination of the old rail menus (ordinaryNav + teamNav in coach-desktop-shell.tsx before FIX 6), by address.
  const g = `/groups/${G}`;
  const OLD: string[] = [
    "/clients", "/calendar", `${g}/messages`, "/programs", `${g}/exercise-library`, `${g}/nutrition`,
    `${g}/business`, `${g}/business/packages`, `${g}/resources`, `${g}/business/website`, "/calendar?tab=availability", `${g}/business/session-types`, `${g}/business/booking-page`,
    `${g}/business/waiver`, `${g}/business/leads`, `${g}/business/session-ledger`, `${g}/branding`, `${g}/business/zapier`, "/admin/organizations", "/admin/marketplace-ranking",
    `${g}/clients?view=members`, `${g}/dashboard`, `${g}/team-performance`, `${g}/attendance`, `${g}/feed`, `${g}/team`, `${g}/team/calendar`, `${g}/group-calendar`, "/group-calendar",
    `${g}/group-sessions`, `${g}/challenges`, `${g}/records`, `${g}/settings`, `${g}/display`, `${g}/kiosk/settings`, "/front-desk", `${g}/business/sms-settings`, `${g}/business/support`,
    `${g}/quick-tips`, "/admin/support", `${g}/team-sheet`, "/dashboard",
  ];
  it("each is a tab in exactly one home (for a coach who sees everything)", () => {
    const tabs = [...HOMES.flatMap((h) => homeTabs(everything)[h.key].map((t) => ({ ...t, home: h.key }))), ...homeTabs({ ...everything, coachLevel: true }).calendar.map((t) => ({ ...t, home: "calendar" as HomeKey })), ...homeTabs({ ...everything, teamSport: true }).programs.map((t) => ({ ...t, home: "programs" as HomeKey }))];
    for (const href of OLD) {
      const homes = new Set(tabs.filter((t) => t.href === href).map((t) => t.home));
      expect(homes.size, href).toBe(1);
    }
  });
});

describe("who sees which tab (the old menus' rules, moved word for word)", () => {
  const keys = (f: HomeFacts, h: HomeKey) => homeTabs(f)[h].map((t) => t.key);
  it("a team-only organization (money hidden): no Business, Leads, Waiver, Session ledger, Packages, Availability, Booking page, Session types, Pro shop, My website, Zapier", () => {
    const f = { ...ordinary, moneyHidden: true };
    const all = HOMES.flatMap((h) => keys(f, h.key));
    for (const k of ["business", "leads", "waiver", "session-ledger", "packages", "availability", "booking-page", "session-types", "resources", "website", "zapier"]) expect(all, k).not.toContain(k);
    expect(keys(f, "settings")).toContain("branding");
  });
  it("a team-sport group: Athletes, the team calendar, Depth chart, Team sheet, the quiet Business tools link; no Group dashboard, Group calendar, Group sessions or Kiosk", () => {
    const f = { ...ordinary, teamSport: true, teamMode: true, moneyHidden: true };
    expect(homeTabs(f).clients[0]).toMatchObject({ key: "members", label: "Athletes" });
    expect(keys(f, "calendar")[0]).toBe("team-calendar");
    expect(keys(f, "programs")).toEqual(expect.arrayContaining(["team", "team-sheet"]));
    expect(keys(f, "settings")).toContain("business-tools");
    for (const k of ["group-dashboard"]) expect(keys(f, "home")).not.toContain(k);
    for (const k of ["group-calendar", "group-sessions", "kiosk"]) expect(keys(f, "calendar")).not.toContain(k);
  });
  it("a team-only coach (no one-on-one clients, no organization with others): Leads, Session ledger, Availability, Session types, Booking page, Pro shop and My website are left out", () => {
    const f = { ...ordinary, navFacts: { coachType: "team" as const, hasOneOnOneClients: false, runsOrgWithOthers: false } };
    const all = HOMES.flatMap((h) => keys(f, h.key));
    for (const k of ["leads", "session-ledger", "availability", "session-types", "booking-page", "resources", "website"]) expect(all, k).not.toContain(k);
    expect(all).toContain("waiver");
  });
  it("a mixed organization's ordinary group keeps every selling tab", () => {
    expect(keys(ordinary, "clients")).toEqual(expect.arrayContaining(["leads", "waiver", "session-ledger", "packages"]));
    expect(keys(ordinary, "home")).toEqual(["today", "business", "group-dashboard"]);
  });
  it("the platform admin gets Support inbox, Organizations and Marketplace ranking; nobody else does", () => {
    expect(keys({ ...ordinary, isPlatformAdmin: true }, "messages")).toContain("admin-support");
    expect(keys({ ...ordinary, isPlatformAdmin: true }, "settings")).toEqual(expect.arrayContaining(["admin-organizations", "admin-ranking"]));
    for (const h of HOMES) expect(keys(ordinary, h.key).filter((k) => k.startsWith("admin"))).toEqual([]);
  });
  it("Front desk only for a front-desk person; Team feed and Attendance only in a team or social group; Members only inside one", () => {
    expect(keys({ ...ordinary, onFrontDesk: true }, "clients")).toContain("front-desk");
    expect(keys(ordinary, "clients")).not.toContain("front-desk");
    const solo = { ...ordinary, groupKind: "one_on_one" as const };
    expect(keys(solo, "messages")).toEqual(["messages"]);
    expect(keys(solo, "clients")).not.toContain("attendance");
    expect(keys(solo, "clients")).not.toContain("members");
    expect(keys({ ...ordinary, coachLevel: true }, "clients")).not.toContain("members");
  });
  it("each home's icon goes to its first tab", () => {
    expect(homeHref(homeTabs(ordinary), "home")).toBe("/dashboard");
    expect(homeHref(homeTabs(ordinary), "messages")).toBe(`/groups/${G}/messages`);
    expect(homeHref(homeTabs({ ...ordinary, teamSport: true, teamMode: true, moneyHidden: true }), "calendar")).toBe(`/groups/${G}/team/calendar`);
  });
});

describe("the pages that only send you somewhere else land in a home", () => {
  it("each redirect page's target is in the table", () => {
    const g = `/groups/${G}`;
    const targets: [string, HomeKey][] = [
      ["/calendar?tab=availability", "calendar"],
      [`${g}/exercise-library`, "programs"],
      [`${g}/nutrition?tab=favorites`, "programs"],
      [`${g}/nutrition?tab=calculator`, "programs"],
      [`${g}/resources?tab=shop`, "settings"],
      [`${g}/resources?tab=referrals`, "settings"],
      [`${g}/feed?channel=general`, "messages"],
      [`${g}/athletes/${ID}?tab=messages`, "clients"],
    ];
    for (const [href, home] of targets) {
      const [path, query] = href.split("?");
      expect(homeOfPath(path, query ? `?${query}` : "")?.home, href).toBe(home);
    }
  });
  it("Availability is its own tab; the Schedule otherwise", () => {
    expect(homeOfPath("/calendar", "?tab=availability")).toEqual({ home: "calendar", tab: "availability" });
    expect(homeOfPath("/calendar")).toEqual({ home: "calendar", tab: "schedule" });
    expect(homeOfPath(`/groups/${G}/clients`, "?view=members")).toEqual({ home: "clients", tab: "members" });
    expect(homeOfPath("/running-low")).toEqual({ home: "clients", tab: "clients" });
    expect(homeOfPath("/recurring-conflicts")).toEqual({ home: "calendar", tab: "schedule" });
  });
});

describe("the phone is not touched", () => {
  it("the phone's route rules do not read the desktop homes", () => {
    expect(readFileSync(join(root, "lib/phone-coach-routes.ts"), "utf8")).not.toContain("desktop-coach-homes");
  });
});
