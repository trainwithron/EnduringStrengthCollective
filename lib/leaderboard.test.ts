import { describe, it, expect } from "vitest";
import { rankLeaderboard } from "./leaderboard";

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
