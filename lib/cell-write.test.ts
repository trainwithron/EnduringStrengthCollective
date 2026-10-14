import { describe, it, expect } from "vitest";
import { cellWrite } from "@/lib/cell-write";

describe("what a builder cell saves", () => {
  it("a rest range keeps both ends (this broke once on a lost backslash: 60-90 was saved as nothing)", () => {
    expect(cellWrite("rest", "60-90")).toEqual({
      patch: { target_rest_seconds: 60, target_rest_max_seconds: 90 },
      local: { targetRestSeconds: 60, targetRestMaxSeconds: 90 },
    });
    expect(cellWrite("rest", "90-150").patch).toEqual({ target_rest_seconds: 90, target_rest_max_seconds: 150 });
  });
  it("a single rest clears any old high end, and an empty one clears both", () => {
    expect(cellWrite("rest", "90").patch).toEqual({ target_rest_seconds: 90, target_rest_max_seconds: null });
    expect(cellWrite("rest", "").patch).toEqual({ target_rest_seconds: null, target_rest_max_seconds: null });
  });
  it("other fields save as before", () => {
    expect(cellWrite("reps", "8-10").patch).toEqual({ target_reps: "8-10" });
    expect(cellWrite("weight", "135").patch).toEqual({ target_weight: 135 });
    expect(cellWrite("weight", "").patch).toEqual({ target_weight: null });
  });
});
