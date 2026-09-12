import { describe, it, expect } from "vitest";
import {
  getDirectComparison,
  getBonusAnimalLine,
  computeKangarooJoeyEquivalent,
  computePandaCubEquivalent,
} from "./transformation-joke-bank";

describe("getDirectComparison", () => {
  it("returns null for zero or negative loss", () => {
    expect(getDirectComparison(0, "seed")).toBeNull();
    expect(getDirectComparison(-5, "seed")).toBeNull();
  });

  it("picks a real object near the given weight", () => {
    const result = getDirectComparison(20, "athlete-1");
    expect(result).not.toBeNull();
    expect(result!.label.length).toBeGreaterThan(0);
    expect(result!.text).toContain(result!.label);
  });

  it("is deterministic for the same seed", () => {
    const a = getDirectComparison(35, "same-seed");
    const b = getDirectComparison(35, "same-seed");
    expect(a).toEqual(b);
  });

  it("produces real variety across different seeds at a tied weight", () => {
    // 10 lbs has multiple real candidates (housecat, bowling ball) —
    // confirm at least two distinct labels show up across many seeds.
    const labels = new Set(
      Array.from({ length: 20 }, (_, i) => getDirectComparison(10, `seed-${i}`)!.label)
    );
    expect(labels.size).toBeGreaterThan(1);
  });
});

describe("computeKangarooJoeyEquivalent / computePandaCubEquivalent", () => {
  it("matches the resolved design's own worked example for a 10 lb loss", () => {
    // "over 5,000 kangaroo joeys" / "~46 panda cubs" at 10 lbs.
    expect(computeKangarooJoeyEquivalent(10)).toBeGreaterThan(5000);
    expect(computePandaCubEquivalent(10)).toBe(46);
  });
});

describe("getBonusAnimalLine", () => {
  it("returns null for zero or negative loss", () => {
    expect(getBonusAnimalLine(0, "seed")).toBeNull();
  });

  it("returns a real, non-empty line mentioning one of the two bonus animals", () => {
    const line = getBonusAnimalLine(10, "seed")!;
    expect(line).not.toBeNull();
    expect(line.toLowerCase()).toMatch(/kangaroo|panda/);
  });

  it("is deterministic for the same seed", () => {
    expect(getBonusAnimalLine(15, "stable")).toBe(getBonusAnimalLine(15, "stable"));
  });
});
