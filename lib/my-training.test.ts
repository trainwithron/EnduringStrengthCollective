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
      expect(src).toContain('router.push("/my-training")');
      expect(src).not.toContain("Which group");
      expect(src).toContain("Start your own workout");
    }
  });
  it("Assign to Myself lands where My training finds it", () => {
    expect(read("components/coach/desktop/program-card-menu.tsx")).toContain("router.push(`/my-training/open?group=${groupId}`);");
  });
  it("the bar says 'My training' and 'Back to coaching' for a coach in their own app, and Back to coaching also resets the screen size", () => {
    const banner = read("components/athlete/acting-as-banner.tsx");
    expect(banner).toContain("My training");
    expect(banner).toContain("Back to coaching");
    expect(banner).toContain("writeViewOverride(null)");
  });
  it("desktop has the entry in the nav, and Home lists the person's programs from other groups", () => {
    expect(read("components/coach/coach-desktop-shell.tsx")).toContain('href: "/my-training"');
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
