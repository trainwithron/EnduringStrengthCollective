import { describe, expect, it } from "vitest";
import { cornerstoneForSpotterKind } from "./spotter-expert-report";

describe("cornerstoneForSpotterKind", () => {
  it("maps Programming Spotter's checks to the programming cornerstone", () => {
    expect(cornerstoneForSpotterKind("volume_concentration")).toBe("programming");
    expect(cornerstoneForSpotterKind("biomech_redundancy")).toBe("programming");
    expect(cornerstoneForSpotterKind("matched_load_trend_fatigue")).toBe("programming");
  });

  it("maps Nutrition Spotter's checks and goal_reversal to the nutrition cornerstone", () => {
    expect(cornerstoneForSpotterKind("stale_plan")).toBe("nutrition");
    expect(cornerstoneForSpotterKind("goal_reversal")).toBe("nutrition");
  });

  it("maps Calendar Spotter Phase 1 and 2 checks to the calendar cornerstone", () => {
    expect(cornerstoneForSpotterKind("gap")).toBe("calendar");
    expect(cornerstoneForSpotterKind("recurring_gap")).toBe("calendar");
    expect(cornerstoneForSpotterKind("duration_mismatch")).toBe("calendar");
  });

  it("maps Session Pattern Spotter and wellness/engagement signals to habit_recovery", () => {
    expect(cornerstoneForSpotterKind("rpe_creep")).toBe("habit_recovery");
    expect(cornerstoneForSpotterKind("low_readiness")).toBe("habit_recovery");
    expect(cornerstoneForSpotterKind("quiet_client")).toBe("habit_recovery");
  });

  it("returns null for an unrecognized spotter kind", () => {
    expect(cornerstoneForSpotterKind("not_a_real_kind")).toBeNull();
  });
});
