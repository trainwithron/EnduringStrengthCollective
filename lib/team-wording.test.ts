import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { withTeamSportWords } from "@/lib/team-sport";
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
