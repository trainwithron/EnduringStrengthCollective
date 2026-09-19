import { describe, it, expect } from "vitest";
import { SCENIC_BACKGROUNDS, pickScenicBackground, resolvePreferredBackground } from "./scenic-backgrounds";

describe("pickScenicBackground", () => {
  it("is deterministic for the same seed", () => {
    expect(pickScenicBackground("post-1")).toEqual(pickScenicBackground("post-1"));
  });

  it("always returns one of the real stock backgrounds", () => {
    for (const seed of ["a", "b", "c", "d", "e", "f", "g"]) {
      const pick = pickScenicBackground(seed);
      expect(SCENIC_BACKGROUNDS.some((b) => b.key === pick.key)).toBe(true);
    }
  });
});

describe("resolvePreferredBackground", () => {
  it("uses the athlete's preferred key when it matches a real background", () => {
    expect(resolvePreferredBackground("forest", "post-1").key).toBe("forest");
  });

  it("falls back to the seeded rotation when preference is null", () => {
    expect(resolvePreferredBackground(null, "post-1")).toEqual(pickScenicBackground("post-1"));
  });

  it("falls back to the seeded rotation when the preferred key no longer exists", () => {
    expect(resolvePreferredBackground("some_removed_scene", "post-1")).toEqual(
      pickScenicBackground("post-1")
    );
  });
});
