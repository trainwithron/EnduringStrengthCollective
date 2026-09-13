import { describe, expect, it } from "vitest";
import { computeVisibleTileOrder, DEFAULT_TILE_ORDER } from "./dashboard-layout";

describe("computeVisibleTileOrder", () => {
  it("returns the default order when nothing is saved", () => {
    expect(computeVisibleTileOrder([], [])).toEqual([...DEFAULT_TILE_ORDER]);
  });

  it("respects a saved custom order", () => {
    expect(computeVisibleTileOrder(["roster", "stats", "today", "week"], [])).toEqual([
      "roster",
      "stats",
      "today",
      "week",
    ]);
  });

  it("filters out hidden tiles", () => {
    expect(computeVisibleTileOrder([], ["today"])).toEqual(["stats", "week", "roster"]);
  });

  it("appends a tile missing from a stale saved order instead of dropping it", () => {
    // Simulates a coach who saved an order before "roster" existed.
    expect(computeVisibleTileOrder(["today", "stats"], [])).toEqual(["today", "stats", "week", "roster"]);
  });

  it("ignores unknown/stale keys in a saved order", () => {
    expect(computeVisibleTileOrder(["ghost-tile", "stats"], [])).toEqual(["stats", "week", "today", "roster"]);
  });

  it("can hide every tile, returning an empty list", () => {
    expect(computeVisibleTileOrder([], [...DEFAULT_TILE_ORDER])).toEqual([]);
  });
});
