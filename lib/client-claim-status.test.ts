import { describe, expect, it } from "vitest";
import { claimStatus, CLAIM_STATUS_LABEL } from "./client-claim";

const now = new Date("2026-10-10T12:00:00Z");
const future = "2026-10-12T12:00:00Z";

describe("claimStatus finishing_setup", () => {
  it("a link used a few minutes ago, with no claim yet, reads as finishing setup", () => {
    expect(
      claimStatus({ claimedAt: null, latestInvite: { expiresAt: future, usedAt: "2026-10-10T11:50:00Z" }, now })
    ).toBe("finishing_setup");
    expect(CLAIM_STATUS_LABEL.finishing_setup).toBe("Link used, finishing setup");
  });

  it("a cancelled link is not finishing setup", () => {
    expect(
      claimStatus({
        claimedAt: null,
        latestInvite: { expiresAt: future, usedAt: "2026-10-10T11:50:00Z", revokedAt: "2026-10-10T11:50:00Z" },
        now,
      })
    ).toBe("not_signed_in");
  });

  it("a link used days ago means they stopped, not that they are mid-setup", () => {
    expect(
      claimStatus({ claimedAt: null, latestInvite: { expiresAt: future, usedAt: "2026-10-07T12:00:00Z" }, now })
    ).toBe("not_signed_in");
  });

  it("signed in beats everything", () => {
    expect(
      claimStatus({ claimedAt: "2026-10-10T11:55:00Z", latestInvite: { expiresAt: future, usedAt: "2026-10-10T11:50:00Z" }, now })
    ).toBe("active");
  });
});
