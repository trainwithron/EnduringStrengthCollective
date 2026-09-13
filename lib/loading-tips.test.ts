import { describe, expect, it } from "vitest";
import { LOADING_TIPS, pickLoadingTip } from "./loading-tips";

describe("loading-tips content bank", () => {
  it("has a real, non-trivial pool", () => {
    expect(LOADING_TIPS.length).toBeGreaterThanOrEqual(20);
  });

  it("every tip has real text and a citation, no placeholders", () => {
    for (const tip of LOADING_TIPS) {
      expect(tip.text.length).toBeGreaterThan(20);
      expect(tip.citation.length).toBeGreaterThan(5);
      expect(["fact", "correction"]).toContain(tip.type);
    }
  });

  it("ids are unique", () => {
    const ids = new Set(LOADING_TIPS.map((t) => t.id));
    expect(ids.size).toBe(LOADING_TIPS.length);
  });

  it("corrections don't dominate the pool", () => {
    const corrections = LOADING_TIPS.filter((t) => t.type === "correction").length;
    expect(corrections).toBeLessThan(LOADING_TIPS.length * 0.7);
  });

  it("pickLoadingTip always returns a real entry from the pool", () => {
    for (let i = 0; i < 50; i++) {
      const picked = pickLoadingTip();
      expect(LOADING_TIPS).toContainEqual(picked);
    }
  });
});
