import { readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({ programs: [] as any[] }));
vi.mock("@/lib/supabase/server", () => ({
  createServerClient: async () => {
    const chain: any = {};
    for (const m of ["select", "eq", "is", "order", "limit"]) chain[m] = () => chain;
    chain.then = (resolve: (v: unknown) => void) => resolve({ data: state.programs, error: null });
    return { from: () => chain };
  },
}));

import { chooseActiveAnchor } from "@/lib/active-anchor";
import { hubStartGroup } from "@/lib/hub-orgs";
import type { CoachedGroup } from "@/lib/coach-groups";
import { orgIsTeamOnly } from "@/lib/team-sport";
import { programSummary, teamPhoneHome } from "@/lib/team-phone-home";
import { TeamCoachPhoneHome } from "@/components/coach/mobile/team-coach-phone-home";

const src = (p: string) => readFileSync(p, "utf8").replace(/\r\n/g, "\n");

// Ron's real shape: three organizations with one team group each; his personal space has NO organization, so it is not among the coached groups at all.
const HOME_TEAM = "060017b5-e613-4204-a101-c6a14c3a9630";
const COLLECTIVE = "44444444-4444-4444-4444-444444444444";
const TROJANS = "d873ae03-cfe5-440f-bf28-32ea9f70a5b6";
const PERSONAL = "b34d1fca-0000-4000-8000-000000000001";
const ron: CoachedGroup[] = [
  { id: HOME_TEAM, name: "The Home Team", kind: "team", orgId: "org-c2c", orgName: "Coast2Coast Fitness" },
  { id: COLLECTIVE, name: "The Enduring Strength Collective", kind: "team", orgId: "org-esc", orgName: "Enduring Strength Co." },
  { id: TROJANS, name: "Trojans", kind: "team", orgId: "org-trojans", orgName: "Lee County West Trojans" },
];

describe("which organization the phone works in when the page is Ron's personal space", () => {
  it("the Spotlight hub starts on the organization Ron chose, never on the personal space", () => {
    expect(hubStartGroup(ron, TROJANS, PERSONAL)).toEqual({ groupId: TROJANS, needsChoice: false });
    expect(hubStartGroup(ron, COLLECTIVE, PERSONAL)).toEqual({ groupId: COLLECTIVE, needsChoice: false });
  });
  it("with three organizations and none chosen it asks (one plain choice) instead of showing his own programs as the organization's", () => {
    expect(hubStartGroup(ron, null, PERSONAL)).toEqual({ groupId: null, needsChoice: true });
    expect(hubStartGroup(ron, "not-a-group-of-his", PERSONAL)).toEqual({ groupId: null, needsChoice: true });
  });
  it("a coach with ONE organization on the personal space gets that organization; on a group of an organization nothing changes", () => {
    expect(hubStartGroup([ron[2]], null, PERSONAL)).toEqual({ groupId: TROJANS, needsChoice: false });
    expect(hubStartGroup([ron[2]], null, TROJANS)).toEqual({ groupId: TROJANS, needsChoice: false });
    expect(hubStartGroup(ron, null, COLLECTIVE)).toEqual({ groupId: COLLECTIVE, needsChoice: false });
    expect(hubStartGroup([], null, PERSONAL)).toEqual({ groupId: PERSONAL, needsChoice: false });
  });
  it("the coach-level pages (Programs, and the phone Coach home) stand on the organization chosen, and ask when several and none chosen", () => {
    const chosen = chooseActiveAnchor(ron, TROJANS);
    expect(chosen?.anchor.id).toBe(TROJANS);
    expect(chosen?.needsChoice).toBe(false);
    expect(chooseActiveAnchor(ron, null)?.needsChoice).toBe(true);
    expect(chooseActiveAnchor([ron[2]], null)).toMatchObject({ needsChoice: false });
  });
});

describe("the phone coach home of a team-sport group (the Trojans: one team group, 0 athletes, 1 active program)", () => {
  const trojansProgram = {
    id: "e6112860-b29c-4a3b-bb4e-bf99b2f75219",
    name: "8-Week Middle School Athletic Development Program",
    workouts: Array.from({ length: 8 }, (_, w) => [1, 2, 3].map((d) => ({ week_number: w + 1, day_index: d }))).flat(),
  };

  it("leads with the active program, then the team, then ONE More tools", () => {
    const home = teamPhoneHome({ groupId: TROJANS, program: trojansProgram });
    expect(home.program).toEqual({ name: trojansProgram.name, summary: "8 weeks, 3 days a week", href: `/groups/${TROJANS}/programs/${trojansProgram.id}` });
    expect(home.links.map((l) => l.label)).toEqual(["Team calendar", "Team feed", "Athletes", "Messages", "Settings"]);
    expect(home.links.map((l) => l.href)).toEqual([`/groups/${TROJANS}/team/calendar`, `/groups/${TROJANS}/feed`, expect.stringContaining(TROJANS), `/groups/${TROJANS}/messages`, `/groups/${TROJANS}/settings`]);
    const more = home.moreLinks.map((l) => l.label);
    for (const wanted of ["All programs", "Attendance", "Depth chart", "Team performance", "Team sheet", "My own training"]) expect(more, wanted).toContain(wanted);
    // the organization's programs, not this group's alone
    expect(home.moreLinks.find((l) => l.key === "programs")?.href).toBe("/programs");
  });

  it("has no money anywhere and no nag to add a client or build a program", () => {
    const all = JSON.stringify(teamPhoneHome({ groupId: TROJANS, program: trojansProgram }));
    expect(all).not.toMatch(/mrr|revenue|income|payment|paying|credits|package|business|price|\$/i);
    expect(all).not.toMatch(/first client|first program/i);
  });

  it("a program with no dates and no week numbers still reads, and an empty group offers one way to build a program", () => {
    expect(programSummary([{ week_number: null, day_index: 1 }, { week_number: null, day_index: 2 }])).toBe("1 week, 2 days a week");
    expect(programSummary([])).toBe("No workouts yet");
    const none = teamPhoneHome({ groupId: TROJANS, program: null });
    expect(none.program).toBeNull();
    expect(none.newProgramHref).toBe(`/groups/${TROJANS}/programs/new`);
    expect(none.links).toHaveLength(5);
  });

  it("renders the program front and center, the five links and one More tools (and nothing about money or first clients)", async () => {
    state.programs = [{ id: trojansProgram.id, name: trojansProgram.name, workouts: trojansProgram.workouts }];
    const tree = JSON.stringify(await TeamCoachPhoneHome({ groupId: TROJANS, groupName: "Trojans" }), (k, v) => (k === "type" || k === "_owner" || k === "_store" ? undefined : v));
    expect(tree).toContain(trojansProgram.name);
    expect(tree).toContain("8 weeks, 3 days a week");
    expect(tree).toContain("Open the full program");
    for (const label of ["Team calendar", "Team feed", "Athletes", "Messages", "Settings", "More tools"]) expect(tree, label).toContain(label);
    expect(tree).not.toMatch(/MRR|Revenue|Add your first client|Build your first program|Needs attention|Start workout/i);
    state.programs = [];
    const empty = JSON.stringify(await TeamCoachPhoneHome({ groupId: TROJANS, groupName: "Trojans" }), (k, v) => (k === "type" || k === "_owner" || k === "_store" ? undefined : v));
    expect(empty).toContain("No program yet.");
    expect(empty).toContain("Build a program");
    expect(empty).not.toMatch(/Add your first client/i);
  });
});

describe("wiring", () => {
  it("the coach mobile home hands a team-sport group the short home, and the generic home only nags when there is no program", () => {
    const s = src("components/coach/mobile/coach-mobile-home.tsx");
    expect(s).toContain("if (isTeamSportGroup(");
    expect(s).toContain("<TeamCoachPhoneHome groupId={groupId} groupName={groupName} />");
    expect(s.indexOf("<TeamCoachPhoneHome")).toBeLessThan(s.indexOf("const timezone = await getGroupCoachTimezone"));
    expect(s).toContain("(programCount ?? 0) === 0");
  });

  it("the phone Programs link is the organization's Programs page, and that page no longer sends a phone to one group (which sent it straight back)", () => {
    expect(src("components/coach/mobile/coach-nav-links-list.tsx")).toContain('<Item href="/programs" label="Programs"');
    const p = src("app/(coach)/programs/page.tsx");
    expect(p).not.toContain("redirect(`/groups/${anchor.id}/programs`)");
    expect(p).not.toContain("prefersAthleteStyleView");
    expect(p).toContain("Change organization");
  });

  it("the Spotlight hub asks which organization when it cannot tell, and does not act on the personal space", () => {
    const h = src("components/coach/mobile/coach-spot-hub.tsx");
    expect(h).toContain("hubStartGroup(groups, rememberedId, groupId)");
    expect(h).toContain("Which organization are you working in?");
    expect(h).toContain('{view === "program" && !needsOrg && (');
  });

  it("Back to coach home is a clear button and goes to the organization the coach is working in", () => {
    expect(src("components/athlete/acting-as-banner.tsx")).toContain("← Back to coach home");
    const d = src("app/(coach)/dashboard/page.tsx");
    expect(d).toContain("const active = await getActiveAnchor(supabase, user.id);");
    expect(d.indexOf("getActiveAnchor(supabase, user.id)")).toBeLessThan(d.indexOf("pickStartGroup(await loadStartInputs"));
  });

  it("a team organization's desktop Home has no money tiles or needs-payment strip", () => {
    expect(orgIsTeamOnly([{ team_mode: true }])).toBe(true);
    expect(orgIsTeamOnly([{ team_mode: true }, { team_mode: false }])).toBe(false);
    expect(orgIsTeamOnly([])).toBe(false);
    const d = src("app/(coach)/dashboard/page.tsx");
    expect(d).toContain("{!moneyHidden && <NeedsPaymentPanel");
    expect(d).toContain('x.key !== "mrr" && x.key !== "income"');
  });
});
