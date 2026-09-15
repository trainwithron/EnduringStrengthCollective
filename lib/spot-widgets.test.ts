import { describe, expect, it } from "vitest";
import { computeVisibleSpotWidgetOrder, DEFAULT_SPOT_WIDGET_ORDER } from "./spot-widgets";

describe("computeVisibleSpotWidgetOrder", () => {
  it("returns the default order when nothing is saved", () => {
    expect(computeVisibleSpotWidgetOrder([], [])).toEqual([...DEFAULT_SPOT_WIDGET_ORDER]);
  });

  it("respects a saved custom order", () => {
    expect(computeVisibleSpotWidgetOrder(["support", "credits", "waiver"], [])).toEqual([
      "support",
      "credits",
      "waiver",
    ]);
  });

  it("filters out hidden widgets", () => {
    expect(computeVisibleSpotWidgetOrder([], ["waiver"])).toEqual(["credits", "support"]);
  });

  it("appends a widget missing from a stale saved order instead of dropping it", () => {
    expect(computeVisibleSpotWidgetOrder(["support"], [])).toEqual(["support", "credits", "waiver"]);
  });

  it("ignores unknown/stale keys in a saved order", () => {
    expect(computeVisibleSpotWidgetOrder(["ghost-widget", "support"], [])).toEqual([
      "support",
      "credits",
      "waiver",
    ]);
  });

  it("can hide every widget, returning an empty list", () => {
    expect(computeVisibleSpotWidgetOrder([], [...DEFAULT_SPOT_WIDGET_ORDER])).toEqual([]);
  });
});
