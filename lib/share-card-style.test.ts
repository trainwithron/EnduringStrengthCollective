import { describe, it, expect } from "vitest";
import { pickShareCardStyle } from "./share-card-style";

describe("pickShareCardStyle", () => {
  it("is deterministic for the same seed", () => {
    const a = pickShareCardStyle("post-123", true);
    const b = pickShareCardStyle("post-123", true);
    expect(a).toBe(b);
  });

  it("never picks scenic when it's unavailable", () => {
    for (let i = 0; i < 200; i++) {
      expect(pickShareCardStyle(`post-${i}`, false)).not.toBe("scenic");
    }
  });

  it("produces real variety across seeds when scenic is available", () => {
    const results = new Set(Array.from({ length: 60 }, (_, i) => pickShareCardStyle(`post-${i}`, true)));
    expect(results.size).toBeGreaterThan(1);
    expect(results.has("scenic")).toBe(true);
  });

  it("only ever returns bevel or humor when scenic is unavailable", () => {
    const results = new Set(Array.from({ length: 60 }, (_, i) => pickShareCardStyle(`post-${i}`, false)));
    for (const r of results) {
      expect(["bevel", "humor"]).toContain(r);
    }
  });
});
