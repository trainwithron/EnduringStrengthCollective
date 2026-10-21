import { describe, it, expect, vi, beforeEach } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { NextResponse } from "next/server";
import type { CoachedGroup } from "@/lib/coach-groups";

// Ron, Oct 21: on the phone, opening the Trojans showed only his own Home ("all I could see was Christmas abs"). A fresh open starts in the coach's HOME organization; a team organization opens its team Home;
// a switch in Spotlight sticks while working.
const read = (p: string) => readFileSync(join(__dirname, "..", p), "utf8").replace(/\r\n/g, "\n");

const ESC = "b7318b19-a17e-4412-88f1-51d68fcf026f";
const C2C = "e369f4a7-c53a-4532-95d3-f7bd14e40e48";
const TROJANS_ORG = "a70b4d99-cf7e-46c6-9b66-3c53df7a91b3";
const COLLECTIVE = "44444444-4444-4444-4444-444444444444";
const HOME_TEAM = "060017b5-e613-4204-a101-c6a14c3a9630";
const TROJANS = "d873ae03-cfe5-440f-bf28-32ea9f70a5b6";
const ronGroups: CoachedGroup[] = [
  { id: HOME_TEAM, name: "The Home Team", kind: "team", orgId: C2C, orgName: "Coast2Coast Fitness" },
  { id: COLLECTIVE, name: "The Enduring Strength Collective", kind: "team", orgId: ESC, orgName: "Enduring Strength Co." },
  { id: TROJANS, name: "Trojans", kind: "team", orgId: TROJANS_ORG, orgName: "Lee County West Trojans" },
];

const state = vi.hoisted(() => ({
  groups: [] as any[],
  modes: [] as { id: string; team_mode: boolean | null }[],
  memberships: [] as { organization_id: string; role: string; created_at: string }[],
  membershipsError: null as { message: string } | null,
  cookies: {} as Record<string, string>,
}));
vi.mock("@/lib/supabase/server", () => ({
  createServerClient: async () => ({
    auth: { getUser: async () => ({ data: { user: { id: "ron" } } }) },
    from: () => {
      const chain: any = { select: () => chain, eq: () => chain, then: (resolve: (v: unknown) => void) => resolve({ data: state.memberships, error: state.membershipsError }) };
      return chain;
    },
  }),
}));
vi.mock("next/headers", () => ({ cookies: async () => ({ get: (name: string) => (name in state.cookies ? { value: state.cookies[name] } : undefined) }) }));
vi.mock("@/lib/read-by-ids", () => ({ readRowsByIds: async () => ({ data: state.modes, error: null }) }));
vi.mock("@/lib/open-own-space", () => ({ openOwnSpaceRedirect: async (_u: unknown, url: URL) => NextResponse.redirect(new URL("/groups/own-space", url)) }));
vi.mock("@/lib/coach-groups", async (importOriginal) => ({ ...(await importOriginal<typeof import("@/lib/coach-groups")>()), getCoachedGroups: async () => state.groups }));

import { homeOrgId } from "./home-org";
import { GET } from "@/app/coach-landing/route";
import { teamPhoneHome } from "./team-phone-home";
import { phoneCoachRedirect } from "./phone-coach-routes";

const RON_OWNS = [
  { organization_id: ESC, role: "owner", created_at: "2026-09-08 00:35:11+00" },
  { organization_id: TROJANS_ORG, role: "owner", created_at: "2026-09-14 02:25:30+00" },
  { organization_id: C2C, role: "owner", created_at: "2026-09-16 17:41:47+00" },
];

describe("the home organization", () => {
  it("is the one the coach owns; the oldest when they own several", () => {
    expect(homeOrgId([C2C, ESC, TROJANS_ORG], RON_OWNS)).toBe(ESC);
    expect(homeOrgId([C2C, ESC, TROJANS_ORG], [{ organization_id: C2C, role: "coach", created_at: "2026-09-01" }, { organization_id: ESC, role: "owner", created_at: "2026-09-08" }, { organization_id: TROJANS_ORG, role: "coach", created_at: "2026-09-02" }])).toBe(ESC);
  });
  it("owning none: the one joined first; no rows: the first organization they coach in; nothing to coach: none", () => {
    expect(homeOrgId([C2C, TROJANS_ORG], [{ organization_id: TROJANS_ORG, role: "coach", created_at: "2026-09-20" }, { organization_id: C2C, role: "coach", created_at: "2026-09-21" }])).toBe(TROJANS_ORG);
    expect(homeOrgId([TROJANS_ORG], [])).toBe(TROJANS_ORG);
    expect(homeOrgId([], RON_OWNS)).toBeNull();
  });
  it("an organization they own but coach nothing in does not count", () => {
    expect(homeOrgId([TROJANS_ORG], [{ organization_id: ESC, role: "owner", created_at: "2026-09-01" }, { organization_id: TROJANS_ORG, role: "coach", created_at: "2026-09-10" }])).toBe(TROJANS_ORG);
  });
});

describe("/coach-landing", () => {
  const open = (q = "") => GET(new Request(`https://spotlightcoaching.app/coach-landing${q}`));
  const where = (res: Response) => new URL(res.headers.get("location")!).pathname;
  beforeEach(() => {
    state.groups = ronGroups;
    state.modes = [{ id: HOME_TEAM, team_mode: false }, { id: COLLECTIVE, team_mode: false }, { id: TROJANS, team_mode: true }];
    state.memberships = RON_OWNS;
    state.membershipsError = null;
    state.cookies = {};
  });

  it("a fresh open starts in the home organization (Enduring Strength Co.), even after working in the Trojans, and opens his own Home", async () => {
    state.cookies = { active_org: TROJANS_ORG, last_workspace_group: TROJANS };
    const res = (await open()) as NextResponse;
    expect(where(res)).toBe("/groups/own-space");
    expect(decodeURIComponent(res.cookies.get("active_org")!.value)).toBe(ESC);
    expect(decodeURIComponent(res.cookies.get("last_workspace_group")!.value)).toBe(COLLECTIVE);
  });
  it("Home while working (?keep=org) keeps the Trojans chosen in Spotlight: the team Home, and nothing is reset", async () => {
    state.cookies = { active_org: TROJANS_ORG, last_workspace_group: TROJANS };
    const res = (await open("?keep=org")) as NextResponse;
    expect(where(res)).toBe(`/groups/${TROJANS}`);
    expect(res.cookies.get("active_org")).toBeUndefined();
    // and back in a business organization, his own Home
    state.cookies = { active_org: ESC };
    expect(where(await open("?keep=org"))).toBe("/groups/own-space");
  });
  it("Kade (the Trojans only) is unchanged: the team Home, started in the Trojans", async () => {
    state.groups = [ronGroups[2]];
    state.modes = [{ id: TROJANS, team_mode: true }];
    state.memberships = [{ organization_id: TROJANS_ORG, role: "coach", created_at: "2026-09-20" }];
    const res = (await open()) as NextResponse;
    expect(where(res)).toBe(`/groups/${TROJANS}`);
    expect(decodeURIComponent(res.cookies.get("active_org")!.value)).toBe(TROJANS_ORG);
  });
  it("a team organization as the home organization opens its team Home on a fresh open", async () => {
    state.memberships = [{ organization_id: TROJANS_ORG, role: "owner", created_at: "2026-09-01" }];
    expect(where(await open())).toBe(`/groups/${TROJANS}`);
  });
  it("the memberships could not be read: the organization already chosen stays (several and none chosen asks, and comes back keeping the choice)", async () => {
    state.membershipsError = { message: "network" };
    state.cookies = { active_org: TROJANS_ORG };
    const kept = (await open()) as NextResponse;
    expect(where(kept)).toBe(`/groups/${TROJANS}`);
    expect(kept.cookies.get("active_org")).toBeUndefined();
    state.cookies = {};
    const ask = await open();
    expect(where(ask)).toBe("/choose-organization");
    expect(new URL(ask.headers.get("location")!).searchParams.get("next")).toBe("/coach-landing?keep=org");
  });
});

describe("while working on the phone", () => {
  it("Home (/dashboard) keeps the organization chosen; only a fresh open (sign-in, the app's icon) resets it", () => {
    expect(phoneCoachRedirect("/dashboard")?.to).toBe("/coach-landing?keep=org");
    expect(read("app/(coach)/dashboard/page.tsx")).toContain("redirect(COACH_PHONE_ENTRY_KEEP_ORG);");
    expect(read("lib/start-group.ts")).toContain('return onPhone ? COACH_PHONE_ENTRY : "/dashboard";');
  });
  it("choosing a team organization in Spotlight on the coach's own space opens its team Home on a phone (the computer still reloads in place)", () => {
    const hub = read("components/coach/mobile/coach-spot-hub.tsx");
    const block = hub.slice(hub.indexOf("if (leavesPage && pageOrg.current === null) {"), hub.indexOf("if (leavesPage) {\n"));
    expect(block).toContain("const phone = isPhoneView({ override: readBrowserCookie(VIEW_OVERRIDE_COOKIE), userAgent: navigator.userAgent });");
    expect(block).toContain("if (!phone || inOrg.length === 0) {\n        window.location.reload();");
    expect(block).toContain("orgIsTeamOnly(");
    expect(block).toContain("teamHome = `/groups/${next.anchorGroupId}`;");
    expect(block).toContain("if (teamHome) window.location.assign(teamHome);\n        else window.location.reload();");
    // from any organization's page it goes to Home, which keeps the choice: the team Home for the Trojans, his own Home for a business organization
    expect(hub).toContain('window.location.assign("/dashboard");');
  });
  it("the coach's own training stays one way in from the team Home: Athletes, whose first row is the coach (no second link in More tools)", () => {
    const home = teamPhoneHome({ groupId: TROJANS, programs: [], doneAt: new Map(), forByProgram: new Map() });
    expect(home.links.find((l) => l.label === "Athletes")?.href).toBe(`/groups/${TROJANS}/clients?view=members`);
    expect(home.moreLinks.some((l) => l.href.includes("my-space"))).toBe(false);
  });
});
