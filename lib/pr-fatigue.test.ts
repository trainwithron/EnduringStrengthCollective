import { describe, it, expect } from "vitest";
import { isEstablishingBaseline, splitPrsByBaseline } from "./pr-fatigue";

describe("isEstablishingBaseline", () => {
  it("treats 0 and 1 prior sessions as still establishing baseline", () => {
    expect(isEstablishingBaseline(0)).toBe(true);
    expect(isEstablishingBaseline(1)).toBe(true);
  });

  it("treats 2+ prior sessions as a real, established baseline", () => {
    expect(isEstablishingBaseline(2)).toBe(false);
    expect(isEstablishingBaseline(10)).toBe(false);
  });
});

describe("splitPrsByBaseline", () => {
  const makePr = (name: string): { name: string; weight: number; reps: number; oneRepMax: number } => ({
    name,
    weight: 100,
    reps: 5,
    oneRepMax: 116,
  });

  it("splits a brand-new exercise (no prior sessions at all) into establishingBaseline", () => {
    const result = splitPrsByBaseline([makePr("Bulgarian Split Squat")], new Map());
    expect(result.celebrate).toEqual([]);
    expect(result.establishingBaseline).toHaveLength(1);
  });

  it("splits an exercise with a real established history into celebrate", () => {
    const prior = new Map([["Back Squat", 15]]);
    const result = splitPrsByBaseline([makePr("Back Squat")], prior);
    expect(result.celebrate).toHaveLength(1);
    expect(result.establishingBaseline).toEqual([]);
  });

  it("handles a mix of new and established exercises in one PR list", () => {
    const prior = new Map([["Back Squat", 15], ["New Move", 1]]);
    const result = splitPrsByBaseline([makePr("Back Squat"), makePr("New Move")], prior);
    expect(result.celebrate.map((p) => p.name)).toEqual(["Back Squat"]);
    expect(result.establishingBaseline.map((p) => p.name)).toEqual(["New Move"]);
  });

  it("returns empty arrays for an empty PR list", () => {
    expect(splitPrsByBaseline([], new Map())).toEqual({ celebrate: [], establishingBaseline: [] });
  });
});
