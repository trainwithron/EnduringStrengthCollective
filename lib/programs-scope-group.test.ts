import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { groupFromSearch, programsHrefForClient, scopePrograms } from "@/lib/programs-scope";

const W = "11111111-aaaa";
const K = "22222222-bbbb";
const G_W = "aaaaaaaa-0001"; // William's one-on-one group
const G_K = "bbbbbbbb-0002"; // Karina's one-on-one group
const G_TEAM = "cccccccc-0003";

const P = [
  { id: "w-personal", athleteId: W, groupId: G_W },
  { id: "w-group-level", athleteId: null, groupId: G_W },
  { id: "k-personal", athleteId: K, groupId: G_K },
  { id: "k-group-level", athleteId: null, groupId: G_K },
  { id: "team-shared", athleteId: null, groupId: G_TEAM },
  { id: "w-in-team", athleteId: W, groupId: G_TEAM },
];

describe("a client's scoped list matches the client's own Programs tab", () => {
  it("their personal programs AND the programs with no client in their own group", () => {
    expect(scopePrograms(P, W, G_W).map((p) => p.id)).toEqual(["w-personal", "w-group-level", "w-in-team"]);
  });
  it("never another client's programs, nor other groups' shared programs", () => {
    const ids = scopePrograms(P, W, G_W).map((p) => p.id);
    for (const other of ["k-personal", "k-group-level", "team-shared"]) expect(ids).not.toContain(other);
  });
  it("without a known group only the client's personal programs are shown (no guessing)", () => {
    expect(scopePrograms(P, W, null).map((p) => p.id)).toEqual(["w-personal", "w-in-team"]);
  });
  it("no client means all programs", () => {
    expect(scopePrograms(P, null, null)).toHaveLength(P.length);
  });
});

describe("the link from a client's tab names the group they were viewed in", () => {
  it("adds the group to the address", () => {
    expect(programsHrefForClient(W, G_W)).toBe(`/programs?client=${W}&group=${G_W}`);
    expect(programsHrefForClient(W)).toBe(`/programs?client=${W}`);
  });
  it("only a plain id is accepted as the group", () => {
    expect(groupFromSearch(G_W.replace("aaaaaaaa-0001", "aaaaaaaa-0001"))).toBe("aaaaaaaa-0001");
    for (const bad of ["x", "../", "a b", ""]) expect(groupFromSearch(bad)).toBeNull();
  });
  it("the page uses a requested group only if it is one of the coach's own groups, else the client's one-on-one space", () => {
    const page = readFileSync(resolve(__dirname, "../app/(coach)/programs/page.tsx"), "utf8").replace(/\r\n/g, "\n");
    expect(page).toContain("groupIds.includes(requestedGroupId)");
    expect(page).toContain("scopePrograms(all, clientId, clientGroupId)");
  });
});
