import { describe, it, expect } from "vitest";
import { computeRelativeStrengthMilestone } from "./relative-strength-milestone";

describe("computeRelativeStrengthMilestone", () => {
  it("credits crossing 1x bodyweight for the first time", () => {
    // 180 lb bodyweight, est 1RM just reached 180
    expect(computeRelativeStrengthMilestone(180, null, 180)).toEqual({ multiple: 1 });
  });

  it("does not re-fire once already cleared before", () => {
    expect(computeRelativeStrengthMilestone(185, 182, 180)).toBeNull();
  });

  it("credits the highest multiple on a big jump, not the lowest one it also clears", () => {
    // Never lifted before (no prior), jumps straight to 2.2x bodyweight —
    // should be credited at 2x, not 1x.
    expect(computeRelativeStrengthMilestone(396, null, 180)).toEqual({ multiple: 2 });
  });

  it("credits a new higher multiple when prior history already cleared a lower one", () => {
    // Prior best cleared 1x (180) but not 1.5x (270); new set clears 1.5x.
    expect(computeRelativeStrengthMilestone(275, 200, 180)).toEqual({ multiple: 1.5 });
  });

  it("returns null when bodyweight is unknown", () => {
    expect(computeRelativeStrengthMilestone(500, null, null)).toBeNull();
  });

  it("returns null when bodyweight is zero or negative (bad data)", () => {
    expect(computeRelativeStrengthMilestone(500, null, 0)).toBeNull();
  });

  it("returns null when the current lift doesn't clear even the lowest multiple", () => {
    expect(computeRelativeStrengthMilestone(100, null, 180)).toBeNull();
  });
});
