import { describe, it, expect } from "vitest";
import { FREE_TIER_FEE_PERCENT, PAID_OR_TRIAL_FEE_PERCENT, platformFeeCents, platformFeePercent } from "@/lib/platform-fee";
import { deriveOrgEntitlements, type OrgBillingRow } from "@/lib/org-entitlements";

const now = new Date("2026-11-09T12:00:00Z");
const longAgo = new Date("2026-01-01T00:00:00Z");
const row = (over: Partial<OrgBillingRow>): OrgBillingRow => ({ billingExempt: false, trialEndsAt: null, subscriptionStatus: null, currentPeriodEnd: null, orgAddon: false, orgAddonUntil: null, pastDueSince: null, ...over });
const percentFor = (r: OrgBillingRow | null, created: Date, enforced = false) => platformFeePercent(deriveOrgEntitlements(r, created, now, enforced));

describe("the platform fee on a client's payment", () => {
  it("the two rates are 1% and 5%", () => {
    expect(PAID_OR_TRIAL_FEE_PERCENT).toBe(1);
    expect(FREE_TIER_FEE_PERCENT).toBe(5);
  });
  it("a free trial pays 1%", () => {
    expect(percentFor(row({ trialEndsAt: "2026-12-01T00:00:00Z" }), longAgo)).toBe(1);
    expect(percentFor(null, new Date("2026-11-08T00:00:00Z"))).toBe(1);
  });
  it("a paid plan pays 1%, and so does a payment still in its grace period", () => {
    expect(percentFor(row({ subscriptionStatus: "active" }), longAgo)).toBe(1);
    expect(percentFor(row({ subscriptionStatus: "past_due", pastDueSince: "2026-11-08T00:00:00Z" }), longAgo)).toBe(1);
  });
  it("an exempt organization pays 1%", () => {
    expect(percentFor(row({ billingExempt: true }), longAgo)).toBe(1);
  });
  it("the free tier pays 5%: an ended trial, a lapsed plan, a payment unpaid past its grace", () => {
    expect(percentFor(row({ trialEndsAt: "2026-02-01T00:00:00Z" }), longAgo)).toBe(5);
    expect(percentFor(row({ subscriptionStatus: "canceled", currentPeriodEnd: "2026-02-01T00:00:00Z" }), longAgo)).toBe(5);
    expect(percentFor(row({ subscriptionStatus: "past_due", pastDueSince: "2026-01-02T00:00:00Z" }), longAgo)).toBe(5);
  });
  it("follows the real plan state with billing enforcement off", () => {
    const ended = row({ trialEndsAt: "2026-02-01T00:00:00Z" });
    expect(deriveOrgEntitlements(ended, longAgo, now, false).freeTier).toBe(false);
    expect(percentFor(ended, longAgo, false)).toBe(5);
    expect(percentFor(ended, longAgo, true)).toBe(5);
  });
  it("works out whole cents", () => {
    expect(platformFeeCents(10000, 1)).toBe(100);
    expect(platformFeeCents(10000, 5)).toBe(500);
    expect(platformFeeCents(149, 1)).toBe(1);
    expect(platformFeeCents(150, 1)).toBe(2);
  });
});
