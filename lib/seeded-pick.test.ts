import { describe, it, expect } from "vitest";
import { seededPick, hashSeed } from "./seeded-pick";

describe("hashSeed", () => {
  it("is deterministic for the same input", () => {
    expect(hashSeed("post-123")).toBe(hashSeed("post-123"));
  });

  it("differs for different inputs (not a constant)", () => {
    expect(hashSeed("post-123")).not.toBe(hashSeed("post-456"));
  });
});

describe("seededPick", () => {
  const items = ["a", "b", "c", "d", "e"];

  it("always returns the same item for the same seed", () => {
    const first = seededPick(items, "workout-abc");
    const second = seededPick(items, "workout-abc");
    expect(first).toBe(second);
  });

  it("spreads across the array for a range of different seeds", () => {
    const picks = new Set(Array.from({ length: 30 }, (_, i) => seededPick(items, `seed-${i}`)));
    // A real spread, not a disguised constant — expect at least a
    // handful of distinct picks across 30 different seeds.
    expect(picks.size).toBeGreaterThan(1);
  });
});
