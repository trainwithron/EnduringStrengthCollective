import { describe, expect, it } from "vitest";
import { isOnCooldown } from "./coach-briefing-cooldown";

const NOW = new Date(2026, 0, 15);

describe("isOnCooldown", () => {
  it("is false with no prior history at all", () => {
    expect(isOnCooldown("quiet_client::a1", [], NOW)).toBe(false);
  });

  it("is true when the exact signal id was shown within the last 7 days", () => {
    const prior = [{ signalId: "quiet_client::a1", shownAt: new Date(2026, 0, 10) }];
    expect(isOnCooldown("quiet_client::a1", prior, NOW)).toBe(true);
  });

  it("is false once the exact signal id's prior showing is more than 7 days old", () => {
    const prior = [{ signalId: "quiet_client::a1", shownAt: new Date(2026, 0, 7) }];
    expect(isOnCooldown("quiet_client::a1", prior, NOW)).toBe(false);
  });

  it("is false for a different signal id, even for the same athlete", () => {
    const prior = [{ signalId: "low_readiness::a1", shownAt: new Date(2026, 0, 14) }];
    expect(isOnCooldown("quiet_client::a1", prior, NOW)).toBe(false);
  });

  it("respects a custom cooldown window", () => {
    const prior = [{ signalId: "quiet_client::a1", shownAt: new Date(2026, 0, 12) }];
    expect(isOnCooldown("quiet_client::a1", prior, NOW, 2)).toBe(false);
    expect(isOnCooldown("quiet_client::a1", prior, NOW, 5)).toBe(true);
  });
});
