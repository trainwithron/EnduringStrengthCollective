import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { resolveMyTraining, myPrograms, type MyMembershipRow, type MyProgramInput } from "@/lib/my-training";

const read = (rel: string) => readFileSync(join(__dirname, "..", rel), "utf8").replace(/\r\n/g, "\n");

const m = (group_id: string, role: string, group_kind: string, group_name: string, joined_at = "2026-01-01"): MyMembershipRow => ({ group_id, role, group_kind, group_name, joined_at });
const p = (id: string, group_id: string, athlete_id: string | null, name = id): MyProgramInput => ({ id, name, group_id, athlete_id });

describe("My training: which group opens", () => {
  const ron = "ron";
  // Ron today: coach of one team group (where his own programs live) and of many clients' one-on-one spaces.
  const memberships = [m("team", "coach", "team", "The Collective"), m("c1", "coach", "one_on_one", "Client One"), m("c2", "coach", "one_on_one", "Client Two"), m("home", "coach", "team", "The Home Team", "2026-02-01")];

  it("opens the one group that holds the coach's own program", () => {
    const programs = [p("p1", "team", ron, "Squat block"), p("p2", "team", ron, "Mobility"), p("x", "c1", "client1"), p("shared", "home", null)];
    expect(resolveMyTraining(ron, memberships, programs)).toEqual({ kind: "open", groupId: "team" });
  });
  it("a coach's view of a group's shared team program is not 'mine'", () => {
    expect(myPrograms(ron, memberships, [p("shared", "home", null)])).toEqual([]);
  });
  it("lists PROGRAMS, ordered by group name then program name, when they are in several groups", () => {
    const programs = [p("b", "team", ron, "Mobility"), p("a", "home", ron, "Strength"), p("c", "team", ron, "Squat block")];
    const r = resolveMyTraining(ron, memberships, programs);
    expect(r.kind).toBe("choose");
    if (r.kind === "choose") expect(r.programs.map((x) => `${x.groupName}/${x.programName}`)).toEqual(["The Collective/Mobility", "The Collective/Squat block", "The Home Team/Strength"]);
  });
  it("with no program yet, opens the group the coach would land in anyway (a team group, never a client's one-on-one space)", () => {
    expect(resolveMyTraining(ron, memberships, [], { lastGroupId: "home" })).toEqual({ kind: "open", groupId: "home" });
    expect(resolveMyTraining(ron, memberships, [])).toEqual({ kind: "open", groupId: "team" });
  });
  it("belonging to no group at all means there is nothing to open", () => {
    expect(resolveMyTraining(ron, [], [])).toEqual({ kind: "none" });
  });
  it("is the same answer every time for the same data", () => {
    const programs = [p("a", "team", ron), p("b", "home", ron)];
    expect(resolveMyTraining(ron, memberships, programs)).toEqual(resolveMyTraining(ron, [...memberships].reverse(), [...programs].reverse()));
  });
});

describe("My training for a client", () => {
  const me = "client";
  const memberships = [m("team", "athlete", "team", "Team"), m("solo", "athlete", "one_on_one", "My space")];
  it("a client's own program and the group's shared one are both theirs; a one-on-one space's no-client template is not", () => {
    const programs = [p("shared", "team", null), p("mine", "solo", me), p("template", "solo", null)];
    expect(myPrograms(me, memberships, programs).map((x) => x.programId).sort()).toEqual(["mine", "shared"]);
  });
  it("programs in two groups open as a list of programs; in one group, straight in", () => {
    expect(resolveMyTraining(me, memberships, [p("shared", "team", null), p("mine", "solo", me)]).kind).toBe("choose");
    expect(resolveMyTraining(me, memberships, [p("shared", "team", null)])).toEqual({ kind: "open", groupId: "team" });
  });
});

describe("the pieces are wired", () => {
  it("the open route sets the act-as setting for a coach only, for a group they belong to, and nothing for a client", () => {
    const route = read("app/my-training/open/route.ts");
    expect(route).toContain("UUID.test(groupId)");
    expect(route).toContain('from("group_memberships")');
    expect(route).toContain('if (membership.role === "coach") {');
    expect(route).toContain("JSON.stringify({ athleteId: user.id, groupId })");
  });
  it("both coach pickers go straight to My training: no 'Which group's program?' step", () => {
    for (const f of ["components/athlete/view-as-client-picker.tsx", "components/coach/mobile/spot-clients-groups-panel.tsx"]) {
      const src = read(f);
      expect(src).toContain('router.push("/my-space?view=client")');
      expect(src).not.toContain("Which group");
      expect(src).toContain("Start your own workout");
    }
  });
  it("Assign (Me) files the program in the coach's personal space", () => {
    const panel = read("components/coach/desktop/program-assign-panel.tsx");
    expect(panel).toContain('supabase.rpc("ensure_personal_space")');
    expect(panel).toContain("destinationGroupId: dest as string");
  });
  it("the coach's own client app has no bar or nav entry of its own: the normal Viewing-as bar, and Home lists the person's programs", () => {
    const banner = read("components/athlete/acting-as-banner.tsx");
    expect(banner).not.toContain("My training");
    expect(banner).toContain("writeViewOverride(null)");
    expect(read("components/coach/coach-desktop-shell.tsx")).not.toContain('href: "/my-training"');
    expect(read("app/(coach)/groups/[groupId]/page.tsx")).toContain("OtherProgramsCard");
  });
});

describe("Removing a program from my list", () => {
  it("is offered only for a program made for the person in a group where they are the coach (the database lets only a coach change a program)", () => {
    const rows = myPrograms("u", [m("g1", "coach", "team", "A"), m("g2", "athlete", "team", "B")], [p("a", "g1", "u"), p("b", "g2", "u"), p("c", "g2", null)]);
    const by = Object.fromEntries(rows.map((r) => [r.programId, r.canRemove]));
    expect(by).toEqual({ a: true, b: false, c: false });
  });
  it("treats an update that changed nothing as a failure, and Hide is kept off an active shared program", () => {
    expect(read("components/coach/client-program-menu.tsx")).toContain("removed.length === 0");
    expect(read("components/coach/desktop/program-card-grid.tsx")).toContain("canHide={!program.athleteId && !program.isActive}");
  });
});

describe("The coach as their own client (personal space)", () => {
  it("the Clients list has the coach's own row first, outside the counts, filters and search, labelled with their profile name", () => {
    const list = read("components/coach/desktop/coach-clients-list.tsx");
    expect(list).toContain("{selfName} (you)");
    expect(list).toContain('href="/my-space"');
    expect(list.indexOf("{selfName} (you)")).toBeLessThan(list.indexOf("{shown.length === 0 ? ("));
    expect(read("app/(coach)/clients/page.tsx")).toContain("selfName={selfName}");
    expect(read("lib/coach-clients.ts")).not.toContain("ensure_personal_space");
  });
  it("/my-space makes the space on first use and opens the coach's own client profile, or their client app with ?view=client", () => {
    const route = read("app/my-space/route.ts");
    expect(route).toContain('rpc("ensure_personal_space")');
    expect(route).toContain("/groups/${spaceId}/athletes/${user.id}");
    expect(route).toContain("/my-training/open?group=${spaceId}");
    expect(read("app/my-training/page.tsx")).toContain('redirect("/my-space?view=client")');
  });
  it("on their own profile the Billing tab, the message box and the video check-in are gone", () => {
    expect(read("lib/client-profile-tabs.ts")).toContain('SELF_HIDDEN_TABS: ClientProfileTab[] = ["settings"]');
    const profilePage = read("app/(coach)/groups/[groupId]/athletes/[athleteId]/page.tsx");
    expect(profilePage.slice(profilePage.indexOf("<OverviewMessageBox") - 60, profilePage.indexOf("<OverviewMessageBox"))).toContain("!selfView");
    const page = read("app/(coach)/groups/[groupId]/athletes/[athleteId]/page.tsx");
    expect(page).toContain("hide={selfView ? SELF_HIDDEN_TABS : []}");
    expect(page).toContain("{!selfView && <VideoCheckinRecorder");
  });
  it("the personal space never becomes the open workspace, and is invisible to every coach-wide scope", () => {
    expect(read("lib/supabase/middleware.ts")).toContain("if (ownMembership && memberOrg)");
    expect(read("lib/coach-groups.ts")).toContain("!g.organization_id");
  });
});

describe("Personal space: only coaches, and no briefings for it", () => {
  it("the database refuses a non-coach, and the page and Assign to Myself say so calmly", () => {
    expect(read("supabase/migrations/0358_personal_space.sql")).toContain("Only coaches have a personal space.");
    expect(read("app/my-space/route.ts")).toContain("Only coaches have a personal space.");
    expect(read("components/coach/desktop/program-assign-panel.tsx")).toContain("Only coaches have a personal space.");
  });
  it("the daily briefing and the digest skip a group with no organization", () => {
    expect(read("app/api/cron/coach-briefing/route.ts")).toContain("if (!organizationId) continue;");
    expect(read("app/api/cron/coach-digest/route.ts")).toContain("if (!g?.organization_id) continue;");
  });
});

describe("The coach's own profile shows only what is theirs", () => {
  const page = read("app/(coach)/groups/[groupId]/athletes/[athleteId]/page.tsx");
  it("hides the client-only items on their own profile: the quiet nudges, sign-in help, the Joined line, and says Set a goal", () => {
    expect(page).toContain('!selfView && signInStatus === "active" && quietTier === "strong"');
    expect(page).toContain('!selfView && signInStatus === "active" && quietTier === "mild"');
    expect(page).toContain('{!selfView && signInStatus !== "active" && (');
    expect(page).toContain('{!selfView && signInStatus === "active" && (');
    expect(page).toContain("{!selfView && <>Joined ");
    expect(page).toContain('{selfView ? "Set a goal" : "Suggest a goal"}');
  });
  it("every read on the page is for the one athlete in the one group named in the address (the space holds nobody else)", () => {
    expect(page).toContain('.eq("group_id", params.groupId)');
    expect(page).toContain('.eq("profile_id", params.athleteId)');
  });
});
