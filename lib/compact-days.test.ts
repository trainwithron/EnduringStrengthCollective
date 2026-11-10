import { describe, expect, it } from "vitest";
import { compactKey, readCompactOr } from "./compact-days";

const store = (v: Record<string, string>) => ({ getItem: (k: string) => v[k] ?? null });

describe("readCompactOr", () => {
  it("a week never switched starts with the fallback", () => {
    expect([...readCompactOr(store({}), "p", 1, ["a", "b"])]).toEqual(["a", "b"]);
  });
  it("a week the coach switched keeps their choice, even all full", () => {
    expect([...readCompactOr(store({ [compactKey("p", 1)]: "[]" }), "p", 1, ["a"])]).toEqual([]);
    expect([...readCompactOr(store({ [compactKey("p", 1)]: '["b"]' }), "p", 1, ["a"])]).toEqual(["b"]);
  });
  it("no storage: the fallback", () => {
    expect([...readCompactOr(null, "p", 1, ["a"])]).toEqual(["a"]);
  });
});
