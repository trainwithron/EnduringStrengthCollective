import { describe, expect, it } from "vitest";
import { parseBiomechTagSuggestions } from "./biomech-tag-suggestions";

const VALID_KEYS = new Set(["hip_extension", "knee_extension", "anti_flexion_stability"]);

describe("parseBiomechTagSuggestions", () => {
  it("passes through a valid array", () => {
    const result = parseBiomechTagSuggestions(
      [
        { key: "hip_extension", role: "prime_mover" },
        { key: "anti_flexion_stability", role: "stabilizer_demand" },
      ],
      VALID_KEYS
    );
    expect(result).toEqual([
      { key: "hip_extension", role: "prime_mover" },
      { key: "anti_flexion_stability", role: "stabilizer_demand" },
    ]);
  });

  it("filters out a hallucinated key not in the real vocabulary", () => {
    const result = parseBiomechTagSuggestions(
      [{ key: "made_up_tag", role: "prime_mover" }, { key: "hip_extension", role: "prime_mover" }],
      VALID_KEYS
    );
    expect(result).toEqual([{ key: "hip_extension", role: "prime_mover" }]);
  });

  it("filters out an invalid role", () => {
    const result = parseBiomechTagSuggestions([{ key: "hip_extension", role: "does_everything" }], VALID_KEYS);
    expect(result).toEqual([]);
  });

  it("dedupes a repeated key, keeping the first occurrence", () => {
    const result = parseBiomechTagSuggestions(
      [
        { key: "hip_extension", role: "prime_mover" },
        { key: "hip_extension", role: "stabilizer_demand" },
      ],
      VALID_KEYS
    );
    expect(result).toEqual([{ key: "hip_extension", role: "prime_mover" }]);
  });

  it("returns [] for non-array input", () => {
    expect(parseBiomechTagSuggestions({ not: "an array" }, VALID_KEYS)).toEqual([]);
    expect(parseBiomechTagSuggestions(null, VALID_KEYS)).toEqual([]);
    expect(parseBiomechTagSuggestions("nope", VALID_KEYS)).toEqual([]);
  });

  it("skips malformed items without throwing", () => {
    const result = parseBiomechTagSuggestions(
      [null, "string", 42, {}, { key: "hip_extension" }, { role: "prime_mover" }, { key: 5, role: "prime_mover" }],
      VALID_KEYS
    );
    expect(result).toEqual([]);
  });
});
