import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { assignableGroupsFrom, newProgramIsOrgProgram, programPlace } from "./org-programs";
import type { CoachedGroup } from "./coach-groups";

// Ron, Oct 26: "i want programs tied to the org and assignable to client and group in the org"; "it wont show the collective unless in working in the group called the collective, groups are
// different than clients. clients can go in groups but not the other way around". The database side (the mark, the backfill, a client never reading an organization program, assigning always
// copying one) is rehearsed in scripts/sql-tests/rehearsal/0435.test.mjs.
const read = (p: string) => readFileSync(join(__dirname, "..", p), "utf8").replace(/\r\n/g, "\n");
const g = (id: string, name: string, kind: CoachedGroup["kind"], orgId: string, extra: Partial<CoachedGroup> = {}): CoachedGroup => ({ id, name, kind, orgId, orgName: orgId === "esc" ? "Enduring Strength Co." : "Other Gym", ...extra });
const coached: CoachedGroup[] = [
  g("4444", "The Enduring Strength Collective", "team", "esc"),
  g("t1", "Tuesday Bootcamp", "social", "esc"),
  g("o1", "Hewan Belete", "one_on_one", "esc"),
  g("old", "Spring 2025", "team", "esc", { archived: true }),
  g("x1", "Other Gym Team", "team", "other"),
  g("x2", "Other Gym Client", "one_on_one", "other"),
];

describe("the top of a program's page", () => {
  it("an organization program says Programs, never the group it is stored in, in either organization", () => {
    expect(programPlace({ orgProgram: true, athleteName: null, groupName: "The Enduring Strength Collective" })).toBe("Programs");
    expect(programPlace({ orgProgram: true, athleteName: null, groupName: "Other Gym Team" })).toBe("Programs");
  });
  it("a client's copy keeps the client's name, a group's program its group", () => {
    expect(programPlace({ orgProgram: false, athleteName: "Hewan Belete", groupName: "The Enduring Strength Collective" })).toBe("Hewan Belete");
    expect(programPlace({ orgProgram: false, athleteName: null, groupName: "The Enduring Strength Collective" })).toBe("The Enduring Strength Collective");
  });
  it("the builder page labels the shell from the mark, and the shell neither badges nor remembers the anchor group then", () => {
    const page = read("app/(coach)/groups/[groupId]/programs/[programId]/page.tsx");
    expect(page).toContain("groupName={programPlace({ orgProgram: data.orgProgram, athleteName: null, groupName: data.groupName })} programLibrary={data.orgProgram}");
    const shell = read("components/coach/coach-desktop-shell.tsx");
    expect(shell).toContain('if (coachLevel || programLibrary || groupKind === null || groupKind === "one_on_one") return;');
    expect(shell).toContain("{groupKind && !coachLevel && !programLibrary && (");
    expect(read("lib/program-builder-data.ts")).toContain("orgProgram: (program as { org_program?: boolean | null }).org_program === true,");
  });
});

describe("Assign: the organization's clients and, as their own section, its groups", () => {
  it("groups: the team and social groups of the program's organization only (never a client's space, another organization or a retired season)", () => {
    expect(assignableGroupsFrom(coached, "4444")).toEqual([
      { id: "4444", name: "The Enduring Strength Collective" },
      { id: "t1", name: "Tuesday Bootcamp" },
    ]);
    expect(assignableGroupsFrom(coached, "x1")).toEqual([{ id: "x1", name: "Other Gym Team" }]);
  });
  it("clients stay the organization's clients (the existing list), and a group gets one copy that is that group's program", () => {
    expect(read("lib/assign-clients.ts")).toContain("const groups = (await groupsInOrgOfOpened(supabase, coachId, programGroupId));");
    const lib = read("lib/org-programs.ts");
    expect(lib).toContain('.update({ is_active: true, org_program: false }).eq("id", copy.programId)');
    const panel = read("components/coach/desktop/program-assign-panel.tsx");
    expect(panel).toContain("if (orgProgram) setOrgGroups(await loadAssignableGroups(supabase, user.id, groupId));");
    expect(panel).toContain("assignProgramToGroup(supabase, { sourceProgramId: programId, groupId: g.id, createdBy: user.id, startDate: startDate || undefined })");
    expect(panel).toContain("data-assign-groups");
    // the old "everyone in this group" and position choices are a group program's, not an organization program's
    expect(panel).toContain("const showGroup = !orgProgram && !groupIsOneOnOne");
    expect(panel).toContain("const shownPositions = orgProgram ? [] :");
    expect(read("components/coach/desktop/program-builder-desktop.tsx")).toContain("orgProgram={orgProgram} onClose=");
  });
});

describe("what is made as an organization program", () => {
  it("a program started from the library (or for a client from their page) is the organization's; one from a group's own page is the group's", () => {
    expect(newProgramIsOrgProgram({ athleteId: null, fromLibrary: true })).toBe(true);
    expect(newProgramIsOrgProgram({ athleteId: null, fromLibrary: false })).toBe(false);
    expect(newProgramIsOrgProgram({ athleteId: "a", fromLibrary: true })).toBe(false);
    expect(read("app/(coach)/programs/page.tsx")).toContain('let newProgramQuery = "?library=1";');
    expect(read("components/coach/mobile/programs-phone-list.tsx")).toContain('newProgramQuery = "?library=1"');
    expect(read("components/coach/desktop/program-panel-list.tsx")).toContain("/programs/new?library=1");
    expect(read("components/coach/desktop/getting-started-card.tsx")).toContain("/programs/new?library=1");
    expect(read("app/(coach)/groups/[groupId]/programs/page.tsx")).toContain("href={`/groups/${params.groupId}/programs/new`}");
    expect(read("app/(coach)/groups/[groupId]/programs/new/page.tsx")).toContain('fromLibrary: searchParams.library === "1" || forClient !== null');
    expect(read("components/coach/create-and-open-program.tsx")).toContain("...(orgProgram && athleteId === null ? { org_program: true } : {})");
  });
  it("an import from the library or an organization program's builder, and a library Duplicate, stay the organization's", () => {
    expect(read("components/coach/desktop/import-wizard.tsx")).toContain("...(orgProgram && !athleteId ? { org_program: true } : {}),");
    expect(read("components/coach/desktop/ai-program-builder-box.tsx")).toContain("<ProgramImportLauncher groupId={groupId} athleteId={athleteId} orgProgram={orgProgram} />");
    expect(read("components/coach/mobile/spot-builder-panel.tsx")).toContain("orgProgram={!athleteId}");
    expect(read("components/coach/desktop/program-card-menu.tsx")).toContain("await keepOrgProgramMark(supabase, programId, result.programId);");
  });
});

describe("a group's program is never an organization program, on every screen that shows one", () => {
  it("each 'this group's program' read leaves organization programs out", () => {
    for (const f of [
      "app/(coach)/groups/[groupId]/athletes/[athleteId]/page.tsx",
      "app/(coach)/groups/[groupId]/page.tsx",
      "app/sessions/[sessionId]/recap/page.tsx",
      "components/coach/desktop/client-programs-section.tsx",
      "components/coach/mobile/team-coach-phone-home.tsx",
      "lib/active-programs.ts",
      "lib/team-sheet/load-sheet.ts",
      "app/(coach)/groups/[groupId]/display/page.tsx",
      "components/coach/calendar-page-body.tsx",
      "lib/collective-intelligence-lookups.ts",
    ]) {
      expect(read(f), f).toContain('.eq("org_program", false)');
    }
    expect(read("lib/team-sheet/load-sheet.ts").match(/\.eq\("org_program", false\)/g)).toHaveLength(2);
  });
});
