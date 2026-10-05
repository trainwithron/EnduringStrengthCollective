import { describe, it, expect } from "vitest";
import { claimLinkDetail, daysLeft, groupInviteState, shouldListGroupInvite } from "./invite-state";

const now = new Date("2026-10-10T12:00:00Z");
const future = "2026-10-15T12:00:00Z";
const past = "2026-10-01T12:00:00Z";

describe("groupInviteState", () => {
  it("live, expired and revoked", () => {
    expect(groupInviteState({ expiresAt: future, revokedAt: null }, now)).toBe("live");
    expect(groupInviteState({ expiresAt: past, revokedAt: null }, now)).toBe("expired");
    expect(groupInviteState({ expiresAt: future, revokedAt: "2026-10-09T00:00:00Z" }, now)).toBe("revoked");
  });
  it("a link with no expiry stays live", () => {
    expect(groupInviteState({ expiresAt: null, revokedAt: null }, now)).toBe("live");
  });
});

describe("shouldListGroupInvite", () => {
  it("live links always show", () => {
    expect(shouldListGroupInvite({ expiresAt: future, revokedAt: null }, now)).toBe(true);
  });
  it("a revoked link shows greyed for 7 days, then drops off", () => {
    expect(shouldListGroupInvite({ expiresAt: future, revokedAt: "2026-10-04T12:00:00Z" }, now)).toBe(true);
    expect(shouldListGroupInvite({ expiresAt: future, revokedAt: "2026-10-02T12:00:00Z" }, now)).toBe(false);
  });
  it("an expired link follows the same 7 day rule", () => {
    expect(shouldListGroupInvite({ expiresAt: "2026-10-05T12:00:00Z", revokedAt: null }, now)).toBe(true);
    expect(shouldListGroupInvite({ expiresAt: "2026-09-20T12:00:00Z", revokedAt: null }, now)).toBe(false);
  });
});

describe("daysLeft", () => {
  it("rounds up and never goes negative", () => {
    expect(daysLeft(future, now)).toBe(5);
    expect(daysLeft(past, now)).toBe(0);
    expect(daysLeft(null, now)).toBeNull();
  });
});

describe("claimLinkDetail", () => {
  const base = { createdAt: "2026-10-09T12:00:00Z", expiresAt: future, usedAt: null, revokedAt: null };
  it("signed in beats everything", () => {
    expect(claimLinkDetail({ claimedAt: "2026-10-09T00:00:00Z", latestInvite: base, now }).state).toBe("claimed");
  });
  it("no invite yet", () => {
    expect(claimLinkDetail({ claimedAt: null, latestInvite: null, now }).state).toBe("not_sent");
  });
  it("a working link reports days left", () => {
    const d = claimLinkDetail({ claimedAt: null, latestInvite: base, now });
    expect(d.state).toBe("live");
    expect(d.daysLeft).toBe(5);
  });
  it("expired, cancelled and used links are told apart", () => {
    expect(claimLinkDetail({ claimedAt: null, latestInvite: { ...base, expiresAt: past }, now }).state).toBe("expired");
    expect(claimLinkDetail({ claimedAt: null, latestInvite: { ...base, usedAt: "2026-10-09T13:00:00Z", revokedAt: "2026-10-09T13:00:00Z" }, now }).state).toBe("revoked");
    expect(claimLinkDetail({ claimedAt: null, latestInvite: { ...base, usedAt: "2026-10-09T13:00:00Z" }, now }).state).toBe("used");
  });
});
