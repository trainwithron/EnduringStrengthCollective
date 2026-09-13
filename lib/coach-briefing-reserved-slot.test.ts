import { describe, expect, it } from "vitest";
import { enforceReservedQuietSlot, type BriefingItem, type ReservedSlotCandidate } from "./coach-briefing-reserved-slot";

const NO_QUIET_CANDIDATE: ReservedSlotCandidate[] = [
  { id: "low_readiness::a1", description: "A logged low readiness.", isStrongQuietTier: false },
];

const WITH_QUIET_CANDIDATE: ReservedSlotCandidate[] = [
  { id: "low_readiness::a1", description: "A logged low readiness.", isStrongQuietTier: false },
  { id: "quiet_client::a2", description: "B hasn't logged a workout since 2026-08-01.", isStrongQuietTier: true },
];

describe("enforceReservedQuietSlot", () => {
  it("leaves the chosen items unchanged when no strong-quiet-tier candidate exists at all", () => {
    const chosen: BriefingItem[] = [{ itemType: "observation", headline: "A logged low readiness.", signalIds: ["low_readiness::a1"] }];
    expect(enforceReservedQuietSlot(chosen, NO_QUIET_CANDIDATE, 3)).toEqual(chosen);
  });

  it("leaves the chosen items unchanged when the quiet candidate is already cited", () => {
    const chosen: BriefingItem[] = [
      { itemType: "observation", headline: "B hasn't logged a workout since 2026-08-01.", signalIds: ["quiet_client::a2"] },
    ];
    expect(enforceReservedQuietSlot(chosen, WITH_QUIET_CANDIDATE, 3)).toEqual(chosen);
  });

  it("appends the reserved item when there's room and the model didn't include one", () => {
    const chosen: BriefingItem[] = [{ itemType: "observation", headline: "A logged low readiness.", signalIds: ["low_readiness::a1"] }];
    const result = enforceReservedQuietSlot(chosen, WITH_QUIET_CANDIDATE, 3);
    expect(result).toHaveLength(2);
    expect(result[1].signalIds).toEqual(["quiet_client::a2"]);
  });

  it("replaces the lowest-priority item when the list is already at the cap", () => {
    const chosen: BriefingItem[] = [
      { itemType: "observation", headline: "First.", signalIds: ["low_readiness::a1"] },
      { itemType: "observation", headline: "Second.", signalIds: ["missed_habits::a3"] },
      { itemType: "observation", headline: "Third.", signalIds: ["missed_habits::a4"] },
    ];
    const result = enforceReservedQuietSlot(chosen, WITH_QUIET_CANDIDATE, 3);
    expect(result).toHaveLength(3);
    expect(result[0].headline).toBe("First.");
    expect(result[1].headline).toBe("Second.");
    expect(result[2].signalIds).toEqual(["quiet_client::a2"]);
  });
});
