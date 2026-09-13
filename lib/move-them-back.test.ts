import { describe, expect, it } from "vitest";
import { hasReachedProgressionCeiling } from "./move-them-back";

describe("hasReachedProgressionCeiling", () => {
  it("is false when the slot has no rep range configured at all", () => {
    expect(hasReachedProgressionCeiling(12, null)).toBe(false);
  });

  it("is false when there's no logged history yet", () => {
    expect(hasReachedProgressionCeiling(null, 12)).toBe(false);
  });

  it("is false just under the ceiling", () => {
    expect(hasReachedProgressionCeiling(11, 12)).toBe(false);
  });

  it("is true exactly at the ceiling", () => {
    expect(hasReachedProgressionCeiling(12, 12)).toBe(true);
  });

  it("is true above the ceiling", () => {
    expect(hasReachedProgressionCeiling(15, 12)).toBe(true);
  });
});
