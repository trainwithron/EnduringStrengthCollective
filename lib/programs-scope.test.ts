import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { ALL_PROGRAMS_HREF, clientFromSearch, programsHrefForClient, scopePrograms } from "@/lib/programs-scope";

const P = [
  { id: "p1", athleteId: null, name: "Team block" },
  { id: "p2", athleteId: "11111111-aaaa", name: "William's block" },
  { id: "p3", athleteId: "22222222-bbbb", name: "Karina's block" },
  { id: "p4", athleteId: "11111111-aaaa", name: "William's mobility" },
];

describe("which programs the Programs page shows", () => {
  it("by default, all of them: shared programs and every client's", () => {
    expect(scopePrograms(P, null)).toHaveLength(4);
  });
  it("scoped to one client only when the address names that client", () => {
    expect(scopePrograms(P, "11111111-aaaa").map((p) => p.id)).toEqual(["p2", "p4"]);
  });
  it("the scope comes from the address and nothing else: a plain id is read, anything else is ignored", () => {
    expect(clientFromSearch("11111111-aaaa")).toBe("11111111-aaaa");
    expect(clientFromSearch(["11111111-aaaa", "other"])).toBe("11111111-aaaa");
    for (const bad of [undefined, null, "", "x", "../../etc", "a b", "id;drop table"]) expect(clientFromSearch(bad as string | undefined)).toBeNull();
  });
  it("the links: the plain address clears the scope, the client's address sets it", () => {
    expect(ALL_PROGRAMS_HREF).toBe("/programs");
    expect(programsHrefForClient("11111111-aaaa")).toBe("/programs?client=11111111-aaaa");
  });
});

const read = (p: string) => readFileSync(resolve(__dirname, p), "utf8").replace(/\r\n/g, "\n");

describe("where the scope can and cannot come from", () => {
  const shell = read("../components/coach/coach-desktop-shell.tsx");
  const page = read("../app/(coach)/programs/page.tsx");
  const groupPage = read("../app/(coach)/groups/[groupId]/programs/page.tsx");
  const section = read("../components/coach/desktop/client-programs-section.tsx");
  it("the rail's Programs item is the all-programs page, wherever the coach is standing (not the current group, which could be a client's)", () => {
    expect(shell).toContain('{ key: "programs", label: "Programs", href: ALL_PROGRAMS_HREF');
    expect(shell).not.toContain("href: `/groups/${groupId}/programs`");
  });
  it("the all-programs page lists every program of the coach's groups and scopes only from ?client=", () => {
    expect(page).toContain('.in("group_id", groupIds.length > 0 ? groupIds : [""])');
    expect(page).toContain("clientFromSearch(search.client)");
    expect(page).toContain("scopePrograms(all, clientId)");
  });
  it("when scoped it says so plainly, with a one-click Show all programs", () => {
    expect(page).toContain("programs only");
    expect(page).toContain("Show all programs");
    expect(page).toContain("href={ALL_PROGRAMS_HREF}");
  });
  it("nothing about the scope is stored: no cookie, no localStorage, no session", () => {
    for (const src of [page, section, read("../lib/programs-scope.ts")]) {
      expect(src).not.toMatch(/document\.cookie|localStorage|sessionStorage|cookies\(\)/);
    }
  });
  it("a client's own Programs tab opens the page scoped to that client", () => {
    expect(section).toContain("programsHrefForClient(athleteId)");
  });
  it("a group's own Programs page (a deep link) says it is only that group, and offers everything", () => {
    expect(groupPage).toContain("Showing only");
    expect(groupPage).toContain("Show all programs");
    expect(groupPage).toContain("href={ALL_PROGRAMS_HREF}");
  });
  it("every card links to its own group when the page lists several (new program for a scoped client goes to their group)", () => {
    const grid = read("../components/coach/desktop/program-card-grid.tsx");
    expect(grid).toContain("groupId={p.groupId ?? groupId}");
    expect(page).toContain("groupId: p.group_id");
    expect(page).toContain("`/groups/${newProgramGroupId}/programs/new${newProgramQuery}`");
  });
});
