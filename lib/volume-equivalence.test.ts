import { describe, it, expect } from "vitest";
import { getVolumeEquivalence } from "./volume-equivalence";

describe("getVolumeEquivalence", () => {
  it("picks the heaviest object that still clears 1x the total", () => {
    // 30,000 / 20,000 (school bus) = 1.5 — the next-heaviest reference
    // (blue whale, 300,000) doesn't clear 1x, so school bus wins.
    const result = getVolumeEquivalence(30000);
    expect(result?.plural).toBe("school buses");
    expect(result?.count).toBe(1.5);
    expect(result?.label).toBe("1.5 school buses");
  });

  it("uses singular, article-free phrasing when the count is exactly 1", () => {
    const result = getVolumeEquivalence(2000);
    expect(result?.plural).toBe("Volkswagen Beetles");
    expect(result?.count).toBe(1);
    expect(result?.label).toBe("1 Volkswagen Beetle");
  });

  it("picks blue whales for a very large volume", () => {
    const result = getVolumeEquivalence(600000);
    expect(result?.plural).toBe("blue whales");
    expect(result?.count).toBe(2);
    expect(result?.label).toBe("2 blue whales");
  });

  it("returns null for zero or negative volume", () => {
    expect(getVolumeEquivalence(0)).toBeNull();
    expect(getVolumeEquivalence(-500)).toBeNull();
  });

  it("falls back to a partial lab-rat count for a tiny volume under 1 lb", () => {
    const result = getVolumeEquivalence(0.5);
    expect(result?.plural).toBe("lab rats");
    expect(result?.count).toBe(0.5);
  });
});
