import { describe, it, expect } from "vitest";
import { computeNewlyCrossedThresholds, computeHighestNewThreshold } from "./transformation-milestones";

describe("computeNewlyCrossedThresholds", () => {
  it("returns every threshold at or below the total loss, none seen yet", () => {
    expect(computeNewlyCrossedThresholds(12, new Set())).toEqual([5, 10]);
  });

  it("excludes thresholds already marked as seen", () => {
    expect(computeNewlyCrossedThresholds(12, new Set([5]))).toEqual([10]);
  });

  it("returns nothing when no threshold is cleared", () => {
    expect(computeNewlyCrossedThresholds(3, new Set())).toEqual([]);
  });

  it("returns nothing for zero or negative loss (a gain, not a loss)", () => {
    expect(computeNewlyCrossedThresholds(0, new Set())).toEqual([]);
    expect(computeNewlyCrossedThresholds(-5, new Set())).toEqual([]);
  });

  it("can cross several tiers at once after a logging gap", () => {
    expect(computeNewlyCrossedThresholds(55, new Set())).toEqual([5, 10, 20, 50]);
  });

  it("returns nothing once every relevant threshold is already seen", () => {
    expect(computeNewlyCrossedThresholds(12, new Set([5, 10]))).toEqual([]);
  });
});

describe("computeHighestNewThreshold", () => {
  it("returns the highest newly-crossed threshold, not just the first", () => {
    expect(computeHighestNewThreshold(55, new Set())).toBe(50);
  });

  it("returns null when nothing new was crossed", () => {
    expect(computeHighestNewThreshold(12, new Set([5, 10]))).toBeNull();
  });

  it("returns the single new tier when only one is newly crossed", () => {
    expect(computeHighestNewThreshold(22, new Set([5, 10]))).toBe(20);
  });
});
