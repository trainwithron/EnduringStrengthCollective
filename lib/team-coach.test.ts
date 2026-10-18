import { describe, it, expect, vi, beforeEach } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const db = vi.hoisted(() => ({
  userId: "u1" as string | null,
  coachType: "team" as string | null,
  roles: [] as { organization_id: string; role: string }[],
  orgOthers: [] as { profile_id: string }[],
  coached: [] as { group_id: string; groups: { group_kind: string } }[],
  others: [] as { profile_id: string }[],
  fail: false,
}));

vi.mock("@/lib/supabase/client", () => ({
  createBrowserClient: () => ({
    auth: { getUser: async () => ({ data: { user: db.userId ? { id: db.userId } : null } }) },
    from(table: string) {
      const result = (data: unknown) => ({ data: db.fail ? null : data, error: db.fail ? { message: "x" } : null });
      if (table === "profiles") return { select: () => ({ eq: () => ({ maybeSingle: async () => result({ coach_type: db.coachType }) }) }) };
      if (table === "organization_memberships")
        return {
          select: (cols: string) =>
            cols.includes("organization_id") ? { eq: async () => result(db.roles) } : { in: () => ({ neq: () => ({ limit: async () => result(db.orgOthers) }) }) },
        };
      // group_memberships: the coach's own seats, then the other people in their one-on-one spaces
      return {
        select: (cols: string) =>
          cols.includes("groups (")
            ? { eq: () => ({ eq: async () => result(db.coached) }) }
            : { in: () => ({ eq: () => ({ neq: () => ({ limit: async () => result(db.others) }) }) }) },
      };
    },
  }),
}));

import { loadCoachNavFacts, resetCoachNavFacts } from "@/components/coach/use-coach-type";
import { TEAM_COACH_HIDDEN_NAV, hiddenForCoach, pickTileTeam, teamHomeTiles, tradesMenusAsTeamCoach } from "./team-coach";

const src = (p: string) => readFileSync(join(__dirname, "..", p), "utf8").replace(/\r\n/g, "\n");
const team = { coachType: "team" as const, hasOneOnOneClients: false, runsOrgWithOthers: false };

describe("the team coach's menus", () => {
  it("a coach who only coaches teams does not see the tools for selling to clients; nobody else loses anything", () => {
    for (const key of ["resources", "website", "availability", "session-types", "booking-page", "leads", "session-ledger"]) {
      expect(hiddenForCoach(team, key), key).toBe(true);
      expect(hiddenForCoach({ ...team, coachType: "personal" }, key), key).toBe(false);
      expect(hiddenForCoach({ ...team, coachType: "gym" }, key), key).toBe(false);
      expect(hiddenForCoach({ ...team, coachType: null }, key), key).toBe(false);
      expect(hiddenForCoach(null, key), key).toBe(false);
    }
    for (const key of ["business", "packages", "waiver", "branding", "settings", "kiosk", "display", "team", "attendance", "programs"]) expect(hiddenForCoach(team, key), key).toBe(false);
    expect(TEAM_COACH_HIDDEN_NAV.size).toBe(7);
  });

  it("but a team coach who has a one-on-one client, or runs an organization with other coaches or staff, keeps every menu (they use those tools)", () => {
    expect(tradesMenusAsTeamCoach(team)).toBe(true);
    expect(tradesMenusAsTeamCoach({ ...team, hasOneOnOneClients: true })).toBe(false);
    expect(tradesMenusAsTeamCoach({ ...team, runsOrgWithOthers: true })).toBe(false);
    expect(hiddenForCoach({ ...team, hasOneOnOneClients: true }, "booking-page")).toBe(false);
    expect(hiddenForCoach({ ...team, runsOrgWithOthers: true }, "leads")).toBe(false);
  });

  it("Settings says so, and the desktop and phone menus apply it", () => {
    expect(src("components/coach/coach-type-setting.tsx")).toContain("they always stay if you have a one-on-one client or run an organization with other coaches or staff");
    expect(src("components/coach/coach-desktop-shell.tsx")).toContain("hiddenForCoach(navFacts, i.key)");
    const phone = src("components/coach/mobile/coach-nav-links-list.tsx");
    for (const key of ["availability", "booking-page", "session-types", "session-ledger", "leads", "resources"]) expect(phone, key).toContain(`hiddenForCoach(navFacts, "${key}")`);
  });
});

describe("what the menus know about the coach", () => {
  beforeEach(() => {
    resetCoachNavFacts();
    Object.assign(db, { userId: "u1", coachType: "team", roles: [], orgOthers: [], coached: [], others: [], fail: false });
  });

  it("reads what they coach, whether they have a one-on-one client and whether they run an organization with others", async () => {
    expect((await loadCoachNavFacts())!.facts).toEqual({ coachType: "team", hasOneOnOneClients: false, runsOrgWithOthers: false });
    resetCoachNavFacts();
    db.roles = [{ organization_id: "o1", role: "admin" }];
    db.orgOthers = [{ profile_id: "second" }];
    db.coached = [{ group_id: "g1", groups: { group_kind: "one_on_one" } }];
    db.others = [{ profile_id: "client" }];
    expect((await loadCoachNavFacts())!.facts).toEqual({ coachType: "team", hasOneOnOneClients: true, runsOrgWithOthers: true });
  });

  it("a self-signup team coach owns a solo organization with nobody else in it: the menus are trimmed", async () => {
    db.roles = [{ organization_id: "o1", role: "owner" }];
    db.orgOthers = [];
    const facts = (await loadCoachNavFacts())!.facts;
    expect(facts.runsOrgWithOthers).toBe(false);
    expect(hiddenForCoach(facts, "booking-page")).toBe(true);
  });

  it("a team coach who owns an organization with a second coach keeps every menu", async () => {
    db.roles = [{ organization_id: "o1", role: "owner" }];
    db.orgOthers = [{ profile_id: "second" }];
    const facts = (await loadCoachNavFacts())!.facts;
    expect(facts.runsOrgWithOthers).toBe(true);
    expect(hiddenForCoach(facts, "booking-page")).toBe(false);
  });

  it("a team coach with a one-on-one client keeps every menu even in a solo organization", async () => {
    db.roles = [{ organization_id: "o1", role: "owner" }];
    db.coached = [{ group_id: "g1", groups: { group_kind: "one_on_one" } }];
    db.others = [{ profile_id: "client" }];
    const facts = (await loadCoachNavFacts())!.facts;
    expect(hiddenForCoach(facts, "leads")).toBe(false);
  });

  it("a plain member of someone else's organization (not owner or admin) is judged on their own clients only", async () => {
    db.roles = [{ organization_id: "o1", role: "coach" }];
    db.orgOthers = [{ profile_id: "boss" }];
    expect((await loadCoachNavFacts())!.facts.runsOrgWithOthers).toBe(false);
  });

  it("if the read of who else is in the organization fails, nothing is concluded and the menus stay complete", async () => {
    db.roles = [{ organization_id: "o1", role: "owner" }];
    db.fail = true;
    expect(await loadCoachNavFacts()).toBeNull();
    expect(hiddenForCoach(null, "leads")).toBe(false);
  });

  it("their own personal space (a one-on-one with nobody else in it) is not a client", async () => {
    db.coached = [{ group_id: "g1", groups: { group_kind: "one_on_one" } }];
    db.others = [];
    expect((await loadCoachNavFacts())!.facts.hasOneOnOneClients).toBe(false);
  });

  it("a change in Settings shows at once: the cache is reset", async () => {
    expect((await loadCoachNavFacts())!.facts.coachType).toBe("team");
    db.coachType = "personal";
    expect((await loadCoachNavFacts())!.facts.coachType).toBe("team"); // still the kept answer
    resetCoachNavFacts();
    expect((await loadCoachNavFacts())!.facts.coachType).toBe("personal");
    expect(src("components/coach/coach-type-setting.tsx")).toContain("resetCoachNavFacts();");
  });

  it("a different person signing in on the same page never sees the first person's answer", async () => {
    expect((await loadCoachNavFacts())!.facts.coachType).toBe("team");
    db.userId = "u2";
    db.coachType = "gym";
    const second = await loadCoachNavFacts();
    expect(second!.userId).toBe("u2");
    expect(second!.facts.coachType).toBe("gym");
  });

  it("a failed read, or nobody signed in yet, is never kept", async () => {
    db.fail = true;
    expect(await loadCoachNavFacts()).toBeNull();
    db.fail = false;
    expect((await loadCoachNavFacts())!.facts.coachType).toBe("team");
    resetCoachNavFacts();
    db.userId = null;
    expect(await loadCoachNavFacts()).toBeNull();
    db.userId = "u1";
    expect(await loadCoachNavFacts()).not.toBeNull();
  });
});

describe("the team Home", () => {
  it("has a tile for the roster, the depth chart, practices and games, attendance, the weight room and the TV display, each pointing at a real page", () => {
    const tiles = teamHomeTiles("g1");
    expect(tiles.map((t) => t.key)).toEqual(["roster", "depth", "calendar", "attendance", "weight-room", "tv"]);
    expect(tiles.find((t) => t.key === "tv")).toMatchObject({ href: "/groups/g1/display", newTab: true });
    for (const path of ["team/page.tsx", "team/calendar/page.tsx", "attendance/page.tsx", "kiosk/page.tsx", "display/page.tsx"]) {
      expect(() => readFileSync(join(__dirname, "..", "app/(coach)/groups/[groupId]", path), "utf8"), path).not.toThrow();
    }
  });

  it("the tiles are for a team the coach really coaches: the one they last worked in, else the first by name", () => {
    const teams = [
      { id: "b", name: "Varsity" },
      { id: "a", name: "JV" },
    ];
    expect(pickTileTeam([], null)).toBeNull();
    expect(pickTileTeam(teams, "b")!.id).toBe("b");
    expect(pickTileTeam(teams, "someone-elses")!.id).toBe("a");
    expect(pickTileTeam(teams, null)!.id).toBe("a");
  });

  it("Home builds the list from the coach's own teams, shows a switcher for several, and its team cards leave out retired seasons", () => {
    const home = src("app/(coach)/dashboard/page.tsx");
    expect(home).toContain('coachedForOrg.filter((g) => g.kind === "team"');
    expect(home).toContain("pickTileTeam(tileTeams, rememberedWorkspace)");
    expect(home).toContain("if (g && !g.archived_at) byId.set(g.id, g);");
    expect(home).toContain("if (!(g as GroupRow).archived_at) byId.set(g.id, g as GroupRow);");
    expect(src("components/coach/team-coach-home.tsx")).toContain("teams.length > 1");
  });
});
