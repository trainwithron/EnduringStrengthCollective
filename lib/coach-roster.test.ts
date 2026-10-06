import { describe, it, expect } from "vitest";
import { mergeRosterAcrossGroups, type RosterRowAcrossGroups } from "./coach-roster";
import type { RosterMember } from "./types";

function member(id: string, name: string, last: string | null): RosterMember {
  return { profileId: id, fullName: name, avatarUrl: null, role: "athlete", lastWorkoutAt: last, clientTier: null };
}
function row(groupId: string, groupKind: "one_on_one" | "team" | "social", m: RosterMember): RosterRowAcrossGroups {
  return { groupId, groupKind, member: m };
}

describe("coach-level client roster", () => {
  it("lists a client from every group, not only the group the coach is standing in", () => {
    const merged = mergeRosterAcrossGroups([
      row("g-johann", "one_on_one", member("a", "Johann Gorsek", null)),
      row("g-karina", "one_on_one", member("b", "Karina Ramirez", null)),
      row("g-team", "team", member("c", "Alice Athlete", null)),
    ]);
    expect(merged.map((m) => m.fullName)).toEqual(["Alice Athlete", "Johann Gorsek", "Karina Ramirez"]);
  });
  it("lists a client in two groups once, opened in the one-on-one group, with the latest workout of either", () => {
    const merged = mergeRosterAcrossGroups([
      row("g-team", "team", member("a", "Johann Gorsek", "2026-10-05T10:00:00Z")),
      row("g-solo", "one_on_one", member("a", "Johann Gorsek", "2026-10-01T10:00:00Z")),
    ]);
    expect(merged).toHaveLength(1);
    expect(merged[0].groupId).toBe("g-solo");
    expect(merged[0].lastWorkoutAt).toBe("2026-10-05T10:00:00Z");
  });
  it("returns nothing for no rows", () => {
    expect(mergeRosterAcrossGroups([])).toEqual([]);
  });
});
