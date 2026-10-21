import { readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";

// The team Home's reads: the team programs, the coach's own completions (athlete_sessions / workout_logs), the athletes' copies (programs with .not), their seats and positions.
const state = vi.hoisted(() => ({ programs: [] as any[], copies: [] as any[], sessions: [] as any[], seats: [] as any[], positions: [] as any[] }));
vi.mock("@/lib/supabase/server", () => ({
  createServerClient: async () => ({
    auth: { getUser: async () => ({ data: { user: { id: "coach-kade" } } }) },
    from: (table: string) => {
      let copies = false;
      const chain: any = {};
      for (const m of ["select", "eq", "is", "order", "limit", "in", "range"]) chain[m] = () => chain;
      chain.not = () => ((copies = true), chain);
      chain.then = (resolve: (v: unknown) => void) => {
        const data =
          table === "programs" ? (copies ? state.copies : state.programs) : table === "athlete_sessions" ? state.sessions : table === "group_memberships" ? state.seats : table === "group_positions" ? state.positions : [];
        return resolve({ data, error: null });
      };
      return chain;
    },
  }),
}));

import { chooseActiveAnchor } from "@/lib/active-anchor";
import { hubStartGroup } from "@/lib/hub-orgs";
import type { CoachedGroup } from "@/lib/coach-groups";
import { orgIsTeamOnly } from "@/lib/team-sport";
import { coachPhoneLanding, teamOnlyOrgs } from "@/lib/coach-landing";
import { COACH_PHONE_ENTRY, COACH_PHONE_LANDING, startPath } from "@/lib/start-group";
import { ProgramsPhoneList } from "@/components/coach/mobile/programs-phone-list";
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
    label: null,
    workouts: Array.from({ length: 8 }, (_, w) => [1, 2, 3].map((d) => ({ id: `t${w + 1}-${d}`, week_number: w + 1, day_index: d }))).flat(),
  };
  const conditioning = { id: "p2", name: "Summer conditioning", label: "Conditioning", workouts: [{ id: "c1", week_number: 1, day_index: 1 }] };

  it("a card per program (Start or Continue, where it is up to), then the team links with Attendance third, then ONE More tools", () => {
    const home = teamPhoneHome({ groupId: TROJANS, programs: [trojansProgram], doneAt: new Map([["t1-1", "2026-10-20T15:00:00Z"]]) });
    expect(home.programs).toEqual([
      { id: trojansProgram.id, name: trojansProgram.name, summary: "8 weeks, 3 days a week", upNext: "Up next: Week 1, Day 2", forLine: null, href: `/groups/${TROJANS}/programs/${trojansProgram.id}`, cta: "Continue" },
    ]);
    expect(home.links.map((l) => l.label)).toEqual(["Team calendar", "Athletes", "Attendance", "Messages", "Team feed", "Settings"]);
    expect(home.links.map((l) => l.href)).toEqual([`/groups/${TROJANS}/team/calendar`, expect.stringContaining(TROJANS), `/groups/${TROJANS}/attendance`, `/groups/${TROJANS}/messages`, `/groups/${TROJANS}/feed`, `/groups/${TROJANS}/settings`]);
    const more = home.moreLinks.map((l) => l.label);
    // only the phone app's own places (Oct 19): the computer pages (Depth chart, Team performance, Team sheet, Challenges, the exercise library) are not offered on the phone
    expect(more).toEqual(["All programs", "Nutrition"]);
    expect(JSON.stringify(home.links)).not.toContain("my-space");
    expect(home.moreLinks.find((l) => l.key === "programs")?.href).toBe("/programs");
  });

  it("nothing done yet = Start at Week 1, Day 1; two programs both show, the label as the heading", () => {
    const home = teamPhoneHome({ groupId: TROJANS, programs: [trojansProgram, conditioning] });
    expect(home.programs.map((p) => [p.name, p.cta, p.upNext])).toEqual([
      [trojansProgram.name, "Start", "Up next: Week 1, Day 1"],
      ["Conditioning", "Start", "Up next: Week 1, Day 1"],
    ]);
    expect(teamPhoneHome({ groupId: TROJANS, programs: [] }).programs).toEqual([]);
  });

  it("the For line only when the program was given to athletes, by position, biggest first", () => {
    const home = teamPhoneHome({ groupId: TROJANS, programs: [trojansProgram, conditioning], forByProgram: new Map([[trojansProgram.id, [{ name: "Baseball", count: 3 }, { name: "Football", count: 12 }]], ["p2", []]]) });
    expect(home.programs[0].forLine).toBe("For: Football (12), Baseball (3)");
    expect(home.programs[1].forLine).toBeNull();
  });

  it("has no money anywhere and no nag to add a client or build a program", () => {
    const all = JSON.stringify(teamPhoneHome({ groupId: TROJANS, programs: [trojansProgram] }));
    expect(all).not.toMatch(/mrr|revenue|income|payment|paying|credits|package|business|price|\$/i);
    expect(all).not.toMatch(/first client|first program/i);
  });

  it("a program with no dates and no week numbers still reads, and an empty group offers one way to build a program", () => {
    expect(programSummary([{ week_number: null, day_index: 1 }, { week_number: null, day_index: 2 }])).toBe("1 week, 2 days a week");
    expect(programSummary([])).toBe("No workouts yet");
    const none = teamPhoneHome({ groupId: TROJANS, programs: [] });
    expect(none.newProgramHref).toBe(`/groups/${TROJANS}/programs/new`);
    expect(none.links).toHaveLength(6);
  });

  it("renders every program with Start/Continue and up next, the six links and one More tools (and nothing about money or first clients)", async () => {
    state.programs = [trojansProgram, conditioning];
    state.sessions = [{ id: "s1", workout_id: "t1-1", completed_at: "2026-10-20T15:00:00Z" }];
    state.copies = [{ source_program_id: trojansProgram.id, athlete_id: "a1" }, { source_program_id: trojansProgram.id, athlete_id: "a2" }];
    state.seats = [{ profile_id: "a1", position_id: "pos-fb" }, { profile_id: "a2", position_id: "pos-fb" }];
    state.positions = [{ id: "pos-fb", name: "Football" }];
    const tree = JSON.stringify(await TeamCoachPhoneHome({ groupId: TROJANS, groupName: "Trojans" }), (k, v) => (k === "type" || k === "_owner" || k === "_store" ? undefined : v));
    expect(tree).toContain(trojansProgram.name);
    expect(tree).toContain("Conditioning");
    expect(tree).toContain("8 weeks, 3 days a week");
    expect(tree).toContain("Up next: Week 1, Day 2");
    expect(tree).toContain("For: Football (2)");
    expect(tree).toContain("Continue");
    expect(tree).toContain("Start");
    for (const label of ["Team calendar", "Athletes", "Attendance", "Messages", "Team feed", "Settings", "More tools"]) expect(tree, label).toContain(label);
    expect(tree).not.toMatch(/MRR|Revenue|Add your first client|Build your first program|Needs attention|Start workout/i);
    state.programs = [];
    state.sessions = [];
    state.copies = [];
    const empty = JSON.stringify(await TeamCoachPhoneHome({ groupId: TROJANS, groupName: "Trojans" }), (k, v) => (k === "type" || k === "_owner" || k === "_store" ? undefined : v));
    expect(empty).toContain("No program yet.");
    expect(empty).toContain("Build a program");
    expect(empty).not.toMatch(/Add your first client/i);
  });

  it("reads only active team programs (not archived, not one athlete's copy), in the coach's order", () => {
    const home = src("components/coach/mobile/team-coach-phone-home.tsx");
    expect(home).toContain('.is("athlete_id", null)\n    .is("archived_at", null)\n    .eq("is_active", true)\n    .order("sort_order", { ascending: true, nullsFirst: false })\n    .order("created_at", { ascending: false })\n    .limit(20);');
    expect(home).not.toContain(".limit(1)");
  });
});

describe("the weight-room screen", () => {
  const display = src("app/(coach)/groups/[groupId]/display/page.tsx");
  it("skips archived programs", () => {
    expect(display).toContain('.is("athlete_id", null)\n    .is("archived_at", null)');
  });
  it("a program with no dates shows the workout the coach is up to in it, not 'No workout scheduled today'", () => {
    expect(display).toContain("const { doneAt } = await loadDoneAt(supabase, user.id,");
    expect(display).toContain('if (pick.kind === "next") todaysWorkout = (workouts ?? []).find((w) => w.id === pick.workout.id);');
    expect(display).toContain("if (program.start_date && program.training_days && program.training_days.length > 0) {");
  });
});

describe("wiring", () => {
  it("a coach on a phone: a team-sport group keeps the team Home, any other group opens the coach's own app (Release 2)", () => {
    const s = src("app/(coach)/groups/[groupId]/page.tsx");
    expect(s).toContain("if (isTeamSportGroup(");
    expect(s).toContain("<TeamCoachPhoneHome groupId={params.groupId} groupName={group.name} />");
    expect(s.indexOf("<TeamCoachPhoneHome")).toBeLessThan(s.indexOf("redirect(COACH_PHONE_LANDING);"));
  });

  it("the phone Programs link is the organization's Programs page, and that page no longer sends a phone to one group (which sent it straight back)", () => {
    expect(src("components/coach/mobile/coach-spot-hub.tsx")).toContain('<a href="/programs"');
    const p = src("app/(coach)/programs/page.tsx");
    expect(p).not.toContain("redirect(`/groups/${anchor.id}/programs`)");
    // (a phone is no longer redirected: it gets the simple cards below)
    expect(p).not.toContain("redirect(`/groups/${anchor.id}/programs`)");
    expect(p).toContain("Change organization");
  });

  it("the Spotlight hub asks which organization when it cannot tell, and does not act on the personal space", () => {
    const h = src("components/coach/mobile/coach-spot-hub.tsx");
    expect(h).toContain("hubStartGroup(groups, rememberedId, groupId)");
    expect(h).toContain("Which organization are you working in?");
    expect(h).toContain('{view === "program" && !needsOrg && (');
  });

  it("the bar's exit is a clear button: 'Back to me' on a phone (their own app), 'Back to coach home' at a computer; /dashboard on a phone makes the landing decision", () => {
    const b = src("components/athlete/acting-as-banner.tsx");
    expect(b).toContain('phone ? "← Back to me" : "← Back to coach home"');
    expect(b).toContain('router.push(phone ? COACH_PHONE_LANDING : "/dashboard");');
    // in the organization already chosen (Oct 21: a switch in Spotlight sticks while working)
    expect(src("app/(coach)/dashboard/page.tsx")).toContain("redirect(COACH_PHONE_ENTRY_KEEP_ORG);");
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

describe("where a coach on a phone lands", () => {
  // Ron: three organizations; Home Team and Trojans are team organizations (one team group each); the Collective also has a client's own one-on-one space, so it is not.
  const CLIENT_SPACE = "c0000000-0000-4000-8000-000000000001";
  const groups: CoachedGroup[] = [...ron, { id: CLIENT_SPACE, name: "A Client", kind: "one_on_one", orgId: "org-esc", orgName: "Enduring Strength Co." }];
  const modes = new Map<string, boolean | null>([[HOME_TEAM, true], [COLLECTIVE, true], [TROJANS, true], [CLIENT_SPACE, false]]);
  const teamOnly = teamOnlyOrgs(groups, modes);

  it("only organizations whose every group is a team-sport group count as team organizations", () => {
    expect([...teamOnly].sort()).toEqual(["org-c2c", "org-trojans"]);
  });
  it("a phone first asks which organization (several, none chosen, a team one among them), then lands on the team coach home", () => {
    expect(coachPhoneLanding(groups, null, teamOnly)).toEqual({ to: "choose" });
    expect(coachPhoneLanding(groups, TROJANS, teamOnly)).toEqual({ to: "coach-home", groupId: TROJANS });
    expect(coachPhoneLanding(groups, HOME_TEAM, teamOnly)).toEqual({ to: "coach-home", groupId: HOME_TEAM });
  });
  it("everyone else keeps landing on their own client app", () => {
    expect(coachPhoneLanding(groups, COLLECTIVE, teamOnly)).toEqual({ to: "own" });
    expect(coachPhoneLanding(groups, null, new Set())).toEqual({ to: "own" });
    expect(coachPhoneLanding([], null, teamOnly)).toEqual({ to: "own" });
    expect(coachPhoneLanding([ron[2]], null, new Set())).toEqual({ to: "own" });
    // one organization, a team one: straight to its coach home
    expect(coachPhoneLanding([ron[2]], null, teamOnlyOrgs([ron[2]], new Map([[TROJANS, true]])))).toEqual({ to: "coach-home", groupId: TROJANS });
  });
  it("sign-in sends a coach on a phone to the landing decision, a coach at a computer to the dashboard, and the landing route redirects only", () => {
    expect(startPath({ group_id: TROJANS, role: "coach" }, true)).toBe(COACH_PHONE_ENTRY);
    expect(startPath({ group_id: TROJANS, role: "coach" }, false)).toBe("/dashboard");
    expect(COACH_PHONE_LANDING).toBe("/my-space?view=client");
    const r = src("app/coach-landing/route.ts");
    expect(r).toContain("/choose-organization?next=${encodeURIComponent(COACH_PHONE_ENTRY_KEEP_ORG)}");
    expect(r).not.toMatch(/\.(insert|update|upsert|delete)\(|\.rpc\(/);
  });
});

describe("Programs on a phone", () => {
  it("is simple cards (name, Active, days, tap to open), with no toolbar, filter or import launcher", async () => {
    const programs = [
      { id: "p1", name: "8-Week Middle School Athletic Development Program", isActive: true, workoutCount: 24, coverImagePath: null, athleteId: null, athleteName: null, groupId: TROJANS },
      { id: "p2", name: "Christmas abs", isActive: false, workoutCount: 5, coverImagePath: null, athleteId: "a", athleteName: "Casey", groupId: PERSONAL },
    ];
    const tree = JSON.stringify(ProgramsPhoneList({ programs, groupIdFor: (p) => p.groupId ?? TROJANS, newProgramGroupId: TROJANS }), (k, v) => (k === "type" || k === "_owner" || k === "_store" ? undefined : v));
    expect(tree).toContain("8-Week Middle School Athletic Development Program");
    expect(tree).toContain("Active");
    expect(tree).toContain("Not active");
    expect(tree).toContain(`/groups/${TROJANS}/programs/p1`);
    expect(tree).toContain(`/groups/${TROJANS}/programs/new`);
    expect(tree).not.toMatch(/import|filter|upload|Templates/i);
    const page = src("app/(coach)/programs/page.tsx");
    // read with the rest in one batch (SPEED, Oct 19)
    expect(page).toContain("prefersAthleteStyleView(),");
    expect(page).toContain("if (onPhone) {");
    expect(page.indexOf("<ProgramsPhoneList")).toBeLessThan(page.indexOf("<ProgramsList "));
    expect(page).toContain("<CoachMobileShell groupId={anchor.id} groupName={anchor.name}>");
  });
});

describe("the coach's own training on a phone: ONE row at the top of the Clients (Athletes) list", () => {
  const src = (p: string) => readFileSync(p, "utf8");
  it("the phone roster page leads its list with the coach's own row, which opens their own client app", async () => {
    const page = src("app/(coach)/groups/[groupId]/clients/page.tsx");
    expect(page).toContain("<CoachOwnRow name={selfName} />");
    expect(page.indexOf("<CoachOwnRow")).toBeLessThan(page.indexOf("<CoachRosterMobile"));
    expect(page.indexOf("<CoachOwnRow")).toBeGreaterThan(page.indexOf("if (await prefersAthleteStyleView())"));
    const { COACH_OWN_ROW_HREF } = await import("@/components/coach/mobile/coach-own-row");
    expect(COACH_OWN_ROW_HREF).toBe("/my-space?view=client");
  });
  it("it reads as the coach's name with (you), and the team coach home's Athletes link leads to that same page", async () => {
    const { renderToStaticMarkup } = await import("react-dom/server");
    const { createElement } = await import("react");
    const { CoachOwnRow } = await import("@/components/coach/mobile/coach-own-row");
    const html = renderToStaticMarkup(createElement(CoachOwnRow, { name: "Coach Ron" }));
    expect(html).toContain("Coach Ron (you)");
    expect(html).toContain('href="/my-space?view=client"');
    const home = teamPhoneHome({ groupId: TROJANS, programs: [] });
    expect(home.links.find((l) => l.label === "Athletes")?.href).toBe(`/groups/${TROJANS}/clients?view=members`);
  });
  it("there is no second way in from the coach side: not in More tools, not on the team home, not in the phone hub", () => {
    for (const f of ["lib/team-phone-home.ts", "components/coach/mobile/team-coach-phone-home.tsx", "components/coach/mobile/coach-spot-hub.tsx"]) {
      expect(src(f), f).not.toMatch(/my-space|My own training/);
    }
  });
});
