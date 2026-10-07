import { describe, it, expect } from "vitest";
import { chunk } from "./chunk";

describe("ids in groups", () => {
  it("splits a long list into groups of the size asked for, in order", () => {
    const ids = Array.from({ length: 250 }, (_, i) => i);
    const groups = chunk(ids, 100);
    expect(groups.map((g) => g.length)).toEqual([100, 100, 50]);
    expect(groups.flat()).toEqual(ids);
  });
  it("is empty for nothing and one group for a short list", () => {
    expect(chunk([])).toEqual([]);
    expect(chunk([1, 2, 3])).toEqual([[1, 2, 3]]);
  });
});
