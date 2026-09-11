import { describe, it, expect } from "vitest";
import { rankLeaderboard, rankByPosition, type RosterAthlete } from "./leaderboard";

describe("rankLeaderboard", () => {
  it("ranks by score, highest first", () => {
    const ranked = rankLeaderboard([
      { profileId: "a", fullName: "Alice", score: 10 },
      { profileId: "b", fullName: "Ben", score: 15 },
      { profileId: "c", fullName: "Carla", score: 5 },
    ]);
    expect(ranked.map((r) => r.profileId)).toEqual(["b", "a", "c"]);
    expect(ranked[0].rank).toBe(1);
    expect(ranked[2].rank).toBe(3);
  });

  it("gives tied participants the same rank and skips the next number", () => {
    const ranked = rankLeaderboard([
      { profileId: "a", fullName: "Alice", score: 10 },
      { profileId: "b", fullName: "Ben", score: 10 },
      { profileId: "c", fullName: "Carla", score: 5 },
    ]);
    expect(ranked[0].rank).toBe(1);
    expect(ranked[1].rank).toBe(1);
    expect(ranked[2].rank).toBe(3);
  });

  it("handles an empty list", () => {
    expect(rankLeaderboard([])).toEqual([]);
  });
});

describe("rankByPosition", () => {
  const roster: RosterAthlete[] = [
    { profileId: "a", fullName: "Alice", positionId: "line", positionName: "Line", positionSortOrder: 1 },
    { profileId: "b", fullName: "Ben", positionId: "line", positionName: "Line", positionSortOrder: 1 },
    { profileId: "c", fullName: "Carla", positionId: "qb", positionName: "Quarterback", positionSortOrder: 0 },
    { profileId: "d", fullName: "Dev", positionId: null, positionName: null, positionSortOrder: null },
  ];

  it("buckets athletes by position and ranks each bucket independently", () => {
    const result = rankByPosition(roster, {
      workouts: new Map(),
      volume: new Map([["a", 500], ["b", 300], ["c", 900]]),
      prs: new Map(),
    });
    const line = result.find((r) => r.positionId === "line")!;
    expect(line.volumeRanking.map((e) => e.profileId)).toEqual(["a", "b"]);
    expect(line.volumeRanking[0].rank).toBe(1);
    // Carla's 900 should never affect the Line bucket's ranking at all.
    expect(line.volumeRanking.every((e) => e.score <= 500)).toBe(true);
  });

  it("sorts real positions by positionSortOrder and always puts Unassigned last", () => {
    const result = rankByPosition(roster, { workouts: new Map(), volume: new Map(), prs: new Map() });
    expect(result.map((r) => r.positionName)).toEqual(["Quarterback", "Line", "Unassigned"]);
  });

  it("gives an athlete with no logged activity a score of 0 instead of omitting them", () => {
    const result = rankByPosition(roster, { workouts: new Map(), volume: new Map(), prs: new Map() });
    const unassigned = result.find((r) => r.positionId === null)!;
    expect(unassigned.volumeRanking).toEqual([{ profileId: "d", fullName: "Dev", score: 0, rank: 1 }]);
  });

  it("returns an empty array for an empty roster", () => {
    expect(rankByPosition([], { workouts: new Map(), volume: new Map(), prs: new Map() })).toEqual([]);
  });
});
