import { describe, it, expect } from "vitest";
import { PRESET_SETS, missingPresets } from "./session-type-presets";

describe("starter session types", () => {
  it("a personal trainer gets Online and In person; a team coach gets Weight room, Practice and Game", () => {
    expect(PRESET_SETS.personal.presets.map((p) => p.name)).toEqual(["Online", "In person"]);
    expect(PRESET_SETS.team.presets.map((p) => p.name)).toEqual(["Weight room", "Practice", "Game"]);
  });
  it("Practice and Game cost no session credit; the rest cost the usual one", () => {
    const cost = (n: string) => PRESET_SETS.team.presets.find((p) => p.name === n)?.creditCost;
    expect(cost("Practice")).toBe(0);
    expect(cost("Game")).toBe(0);
    expect(cost("Weight room")).toBe(1);
    expect(PRESET_SETS.personal.presets.every((p) => p.creditCost === 1)).toBe(true);
  });
  it("Online is online; the rest are in person", () => {
    expect(PRESET_SETS.personal.presets.find((p) => p.name === "Online")?.locationKind).toBe("online");
    expect(PRESET_SETS.personal.presets.find((p) => p.name === "In person")?.locationKind).toBe("in_person");
  });
  it("adds only what is missing, ignoring case, so tapping twice never makes a duplicate", () => {
    expect(missingPresets("personal", []).map((p) => p.name)).toEqual(["Online", "In person"]);
    expect(missingPresets("personal", ["online"]).map((p) => p.name)).toEqual(["In person"]);
    expect(missingPresets("team", ["Practice", " game "]).map((p) => p.name)).toEqual(["Weight room"]);
    expect(missingPresets("team", ["Weight room", "Practice", "Game"])).toEqual([]);
  });
});
