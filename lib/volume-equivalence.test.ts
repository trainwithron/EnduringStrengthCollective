import { describe, it, expect } from "vitest";
import { getVolumeEquivalence } from "./volume-equivalence";

describe("getVolumeEquivalence", () => {
  it("returns the identical result for the same volume and seed (determinism)", () => {
    const a = getVolumeEquivalence(12000, "post-abc");
    const b = getVolumeEquivalence(12000, "post-abc");
    expect(a).toEqual(b);
  });

  it("produces real variety across different seeds at the same volume", () => {
    const labels = new Set(
      Array.from({ length: 20 }, (_, i) => getVolumeEquivalence(12000, `post-${i}`)?.label)
    );
    // Real variety, not a disguised constant — different workouts at the
    // same volume shouldn't all land on the exact same object+phrasing.
    expect(labels.size).toBeGreaterThan(1);
  });

  it("never says a count under two (it is 'about one' or a bigger count), and never a fraction", () => {
    for (const volume of [0.4, 3, 40, 900, 8000, 12345, 90000, 450000, 800000]) {
      for (let i = 0; i < 20; i++) {
        const result = getVolumeEquivalence(volume, `seed-${i}`)!;
        expect(result.count).toBeGreaterThanOrEqual(1);
        expect(result.label, result.label).not.toMatch(/(^|s)0.|NaN|undefined|d.d(?! (thousand|million|billion))/);
      }
    }
  });

  it("returns null for zero or negative volume", () => {
    expect(getVolumeEquivalence(0, "post-x")).toBeNull();
    expect(getVolumeEquivalence(-500, "post-x")).toBeNull();
  });

  it("falls back to a sensible single object for a genuinely tiny volume", () => {
    const result = getVolumeEquivalence(0.5, "post-tiny");
    expect(result).not.toBeNull();
    expect(result!.count).toBeGreaterThan(0);
  });

  it("falls back to a sensible single object for a genuinely enormous volume", () => {
    const result = getVolumeEquivalence(50000000, "post-huge");
    expect(result).not.toBeNull();
    expect(result!.count).toBeGreaterThan(0);
  });

  it("uses singular, article-free phrasing when the count is exactly 1", () => {
    // 2000 lbs is exactly the Volkswagen Beetle / Smart car weight —
    // whichever the seed picks, the count-1 case should drop the article.
    const result = getVolumeEquivalence(2000, "post-exact")!;
    if (result.count === 1) {
      expect(result.label.startsWith("1 ")).toBe(true);
      expect(result.label).not.toMatch(/^1 a /);
    }
  });

  it("composes a full sentence containing the resolved object name", () => {
    const result = getVolumeEquivalence(12000, "post-sentence")!;
    const bareName = result.count === 1 ? result.singular.replace(/^(a|an)\s+/i, "") : result.plural;
    expect(result.text).toContain(bareName);
    expect(result.text).toContain(result.emoji);
  });
});
