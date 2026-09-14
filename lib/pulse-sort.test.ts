import { describe, it, expect } from "vitest";
import { sortPulseFirst } from "./pulse-sort";

describe("sortPulseFirst", () => {
  it("moves pinned items ahead of unpinned items", () => {
    const items = [
      { id: "a", pinned: false },
      { id: "b", pinned: true },
      { id: "c", pinned: false },
      { id: "d", pinned: true },
    ];
    const result = sortPulseFirst(items, (i) => i.pinned);
    expect(result.map((i) => i.id)).toEqual(["b", "d", "a", "c"]);
  });

  it("preserves relative order within each partition (stable)", () => {
    const items = [
      { id: "a", pinned: true },
      { id: "b", pinned: false },
      { id: "c", pinned: true },
      { id: "d", pinned: false },
    ];
    const result = sortPulseFirst(items, (i) => i.pinned);
    expect(result.map((i) => i.id)).toEqual(["a", "c", "b", "d"]);
  });

  it("returns the same order when nothing is pinned", () => {
    const items = [{ id: "a" }, { id: "b" }, { id: "c" }];
    const result = sortPulseFirst(items, () => false);
    expect(result.map((i) => i.id)).toEqual(["a", "b", "c"]);
  });

  it("returns the same order when everything is pinned", () => {
    const items = [{ id: "a" }, { id: "b" }, { id: "c" }];
    const result = sortPulseFirst(items, () => true);
    expect(result.map((i) => i.id)).toEqual(["a", "b", "c"]);
  });

  it("handles an empty list", () => {
    expect(sortPulseFirst([], () => true)).toEqual([]);
  });
});
