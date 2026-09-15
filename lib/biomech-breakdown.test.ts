import { describe, expect, it } from "vitest";
import { generateBiomechBreakdown } from "./biomech-breakdown";

describe("generateBiomechBreakdown", () => {
  it("returns a no-tags message when nothing is assigned", () => {
    const result = generateBiomechBreakdown([]);
    expect(result.summary).toBe("No biomechanical tags added yet.");
    expect(result.primeMovers).toEqual([]);
    expect(result.stabilizerDemands).toEqual([]);
  });

  it("handles a single prime mover with no stabilization tags", () => {
    const result = generateBiomechBreakdown([
      { label: "Hip Internal Rotation", description: "d", role: "prime_mover" },
    ]);
    expect(result.summary).toBe("Primarily trains Hip Internal Rotation.");
  });

  it("joins two prime movers with 'and'", () => {
    const result = generateBiomechBreakdown([
      { label: "Hip Internal Rotation", description: "d", role: "prime_mover" },
      { label: "Cross-Body Push", description: "d", role: "prime_mover" },
    ]);
    expect(result.summary).toBe("Primarily trains Hip Internal Rotation and Cross-Body Push.");
  });

  it("joins three or more prime movers with commas and a final 'and'", () => {
    const result = generateBiomechBreakdown([
      { label: "Hip Internal Rotation", description: "d", role: "prime_mover" },
      { label: "Hip External Rotation", description: "d", role: "prime_mover" },
      { label: "Cross-Body Push", description: "d", role: "prime_mover" },
    ]);
    expect(result.summary).toBe(
      "Primarily trains Hip Internal Rotation, Hip External Rotation, and Cross-Body Push."
    );
  });

  it("combines prime movers and stabilizer demands in one sentence, matching Ron's own landmine-press example", () => {
    const result = generateBiomechBreakdown([
      { label: "Hip Internal Rotation", description: "d", role: "prime_mover" },
      { label: "Cross-Body Push", description: "d", role: "prime_mover" },
      { label: "Oblique Sling Stabilization", description: "d", role: "stabilizer_demand" },
    ]);
    expect(result.summary).toBe(
      "Primarily trains Hip Internal Rotation and Cross-Body Push; also challenges Oblique Sling Stabilization."
    );
  });

  it("capitalizes 'Challenges' when there are stabilizer demands but no prime movers", () => {
    const result = generateBiomechBreakdown([
      { label: "Anti-Rotation", description: "d", role: "stabilizer_demand" },
    ]);
    expect(result.summary).toBe("Challenges Anti-Rotation.");
  });

  it("splits assignments into primeMovers and stabilizerDemands correctly", () => {
    const result = generateBiomechBreakdown([
      { label: "A", description: "d", role: "prime_mover" },
      { label: "B", description: "d", role: "stabilizer_demand" },
      { label: "C", description: "d", role: "prime_mover" },
    ]);
    expect(result.primeMovers.map((t) => t.label)).toEqual(["A", "C"]);
    expect(result.stabilizerDemands.map((t) => t.label)).toEqual(["B"]);
  });
});
