import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { NO_TEAM_WORDS_HINT, teamWordsFromHint, withTeamSportWords } from "@/lib/team-sport";
import { termText } from "@/lib/term-text";

const read = (p: string) => readFileSync(p, "utf8").replace(/\r\n/g, "\n");

describe("a team organization says Athletes", () => {
  it("the team default reads 'athletes' unless the coach chose their own word", () => {
    expect(termText(withTeamSportWords({}, true), "client", "plural", { cap: true })).toBe("Athletes");
    expect(termText(withTeamSportWords({}, false), "client", "plural", { cap: true })).toBe("Clients");
    expect(termText(withTeamSportWords({ client: { kind: "preset", value: "player" } }, true), "client", "plural", { cap: true })).toBe("Players");
  });
  it("the words follow the group's team flag OR an organization whose groups are all team-sport", () => {
    const p = read("components/coach/terminology-provider.tsx");
    expect(p).toContain("isTeamSportGroup((group as { team_mode?: boolean | null } | null)?.team_mode)");
    expect(p).toContain("orgIsTeamOnly((orgGroups ?? [])");
  });
  it("the last answer for the group is remembered in the browser and applied as soon as the page is up, so a team coach does not see 'Clients' while the read finishes", () => {
    const p = read("components/coach/terminology-provider.tsx");
    expect(p).toContain("team-sport-words:${groupId}");
    expect(p).toContain('window.localStorage.getItem(`team-sport-words:${groupId}`) === "1"');
    expect(p).toContain('window.localStorage.setItem(`team-sport-words:${groupId}`, "1")');
    expect(p).toContain('window.localStorage.removeItem(`team-sport-words:${groupId}`)');
    // storage can be unavailable: every use is inside try/catch
    expect(p.match(/localStorage/g)?.length).toBe(3);
    expect(p.match(/catch \{/g)?.length ?? 0).toBeGreaterThanOrEqual(2);
  });
});

// Commander, Oct 19: the first navigation still said "Clients" for a team organization, because the server drew the page before the browser's own read finished.
describe("the server draws a team organization's first frame already saying Athletes", () => {
  const G = "11111111-aaaa-bbbb-cccc-000000000001";
  const OTHER = "11111111-aaaa-bbbb-cccc-000000000002";
  it("a page on the remembered team group starts as athletes; the same page for a group that is not a team does not", () => {
    expect(teamWordsFromHint({ groupId: G, groupTeamSport: true, orgTeamOnly: false }, G)).toBe(true);
    expect(teamWordsFromHint({ groupId: G, groupTeamSport: false, orgTeamOnly: false }, G)).toBe(false);
  });
  it("an organization whose groups are all teams says athletes on every one of its groups, even one whose own switch is off (a community group)", () => {
    expect(teamWordsFromHint({ groupId: G, groupTeamSport: false, orgTeamOnly: true }, G)).toBe(true);
  });
  it("a hint about one workspace is never applied to a page on another group (a stale hint can only leave the old behaviour)", () => {
    expect(teamWordsFromHint({ groupId: G, groupTeamSport: true, orgTeamOnly: true }, OTHER)).toBe(false);
    expect(teamWordsFromHint(NO_TEAM_WORDS_HINT, G)).toBe(false);
    expect(teamWordsFromHint({ groupId: null, groupTeamSport: true, orgTeamOnly: true }, G)).toBe(false);
  });
  it("a coach-level page with no group of its own (Home) says athletes only when the whole organization is teams, never for a mix", () => {
    expect(teamWordsFromHint({ groupId: G, groupTeamSport: true, orgTeamOnly: true }, undefined)).toBe(true);
    expect(teamWordsFromHint({ groupId: G, groupTeamSport: true, orgTeamOnly: false }, undefined)).toBe(false);
  });
  it("the group id is compared case-insensitively", () => {
    expect(teamWordsFromHint({ groupId: G, groupTeamSport: true, orgTeamOnly: false }, G.toUpperCase())).toBe(true);
  });
  it("the root layout reads it once per request and the provider starts from it (the browser read and the remembered answer still follow)", () => {
    expect(read("app/layout.tsx")).toContain("getTeamWordsHint()");
    expect(read("app/layout.tsx")).toContain("<TeamWordsHintProvider hint={teamWordsHint}>");
    const p = read("components/coach/terminology-provider.tsx");
    expect(p).toContain("useState(() => teamWordsFromHint(hint, groupId))");
    expect(p).toContain("setTeamSport(isTeam)");
    const s = read("lib/team-words-server.ts");
    expect(s).toContain("cache(async");
    expect(s).toContain("return NO_TEAM_WORDS_HINT;");
    expect(s).not.toContain("getUser");
  });
});
