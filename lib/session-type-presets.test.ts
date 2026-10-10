import { describe, it, expect } from "vitest";
import { PRESET_SETS, missingPresets } from "./session-type-presets";

describe("starter session types", () => {
  it("a personal trainer gets Online and In person; a team coach gets Weight room, Practice and Game", () => {
    expect(PRESET_SETS.personal.presets.map((p) => p.name)).toEqual(["Online", "In person"]);
    expect(PRESET_SETS.team.presets.map((p) => p.name)).toEqual(["Weight room", "Practice", "Game"]);
  });
  it("no preset carries a credit cost: every session costs exactly 1, whatever its type", () => {
    for (const set of Object.values(PRESET_SETS)) for (const p of set.presets) expect(Object.keys(p).sort()).toEqual(["locationKind", "name"]);
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
