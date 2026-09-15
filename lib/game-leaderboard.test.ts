import { describe, it, expect } from "vitest";
import { computeGameLeaderboard } from "./game-leaderboard";

describe("computeGameLeaderboard", () => {
  it("ranks athletes by their best score, highest first", () => {
    const result = computeGameLeaderboard([
      { athleteId: "a", fullName: "Alice", points: 10 },
      { athleteId: "b", fullName: "Ben", points: 25 },
      { athleteId: "c", fullName: "Carla", points: 15 },
    ]);
    expect(result.map((r) => r.fullName)).toEqual(["Ben", "Carla", "Alice"]);
    expect(result.map((r) => r.rank)).toEqual([1, 2, 3]);
  });

  it("uses an athlete's best entry when they've played more than once", () => {
    const result = computeGameLeaderboard([
      { athleteId: "a", fullName: "Alice", points: 10 },
      { athleteId: "a", fullName: "Alice", points: 30 },
      { athleteId: "a", fullName: "Alice", points: 20 },
    ]);
    expect(result).toEqual([{ profileId: "a", fullName: "Alice", score: 30, rank: 1 }]);
  });

  it("gives tied scores the same rank, skipping the next rank", () => {
    const result = computeGameLeaderboard([
      { athleteId: "a", fullName: "Alice", points: 20 },
      { athleteId: "b", fullName: "Ben", points: 20 },
      { athleteId: "c", fullName: "Carla", points: 10 },
    ]);
    expect(result.map((r) => r.rank)).toEqual([1, 1, 3]);
  });

  it("returns an empty list when nobody has scored yet", () => {
    expect(computeGameLeaderboard([])).toEqual([]);
  });
});
