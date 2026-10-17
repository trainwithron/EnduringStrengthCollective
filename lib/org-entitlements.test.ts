import { describe, expect, it } from "vitest";
import { GRACE_DAYS, TRIAL_DAYS } from "@/lib/coach-plan-pricing";
import { deriveOrgEntitlements, type OrgBillingRow } from "@/lib/org-entitlements";

const DAY = 24 * 60 * 60 * 1000;
const now = new Date("2026-10-05T12:00:00Z");
const daysAgo = (n: number) => new Date(now.getTime() - n * DAY);
const daysAgoIso = (n: number) => daysAgo(n).toISOString();

function row(over: Partial<OrgBillingRow> = {}): OrgBillingRow {
  return {
    billingExempt: false,
    trialEndsAt: null,
    subscriptionStatus: null,
    currentPeriodEnd: null,
    orgAddon: false,
    orgAddonUntil: null,
    pastDueSince: null,
    ...over,
  };
}

describe("deriveOrgEntitlements", () => {
  it("exempt orgs always get full access and every add-on feature", () => {
    const e = deriveOrgEntitlements(row({ billingExempt: true }), daysAgo(900), now, true);
    expect(e.state).toBe("exempt");
    expect(e.accessLevel).toBe("full");
    expect(e.orgAddon).toBe(true);
  });

  it("a missing billing row is a trial that runs TRIAL_DAYS from creation", () => {
    const e = deriveOrgEntitlements(null, daysAgo(2), now, true);
    expect(e.state).toBe("trial");
    expect(e.accessLevel).toBe("full");
    expect(e.orgAddon).toBe(true); // trial includes everything
    expect(e.trialDaysLeft).toBe(TRIAL_DAYS - 2);
  });

  it("an explicit trial_ends_at overrides created_at + TRIAL_DAYS", () => {
    const future = new Date(now.getTime() + 30 * DAY).toISOString();
    const e = deriveOrgEntitlements(row({ trialEndsAt: future }), daysAgo(400), now, true);
    expect(e.state).toBe("trial");
    expect(e.trialDaysLeft).toBe(30);
  });

  it("an expired trial drops straight to the free tier: full access to the coach side, no grace, no lock, no add-on", () => {
    for (const daysPast of [1, 3, GRACE_DAYS + 1, 90]) {
      const e = deriveOrgEntitlements(null, daysAgo(TRIAL_DAYS + daysPast), now, true);
      expect(e.state).toBe("trial_expired");
      expect(e.accessLevel).toBe("full");
      expect(e.orgAddon).toBe(false);
      expect(e.graceDaysLeft).toBeNull();
      expect(e.freeTier).toBe(true);
    }
  });

  it("a lapsed or canceled plan is the free tier, never a lock; only an unpaid payment past its grace locks", () => {
    const lapsed = deriveOrgEntitlements(row({ subscriptionStatus: "canceled", currentPeriodEnd: daysAgoIso(10) }), daysAgo(400), now, true);
    expect(lapsed.state).toBe("lapsed");
    expect(lapsed.accessLevel).toBe("full");
    expect(lapsed.freeTier).toBe(true);
    const unpaid = deriveOrgEntitlements(row({ subscriptionStatus: "unpaid" }), daysAgo(400), now, true);
    expect(unpaid.freeTier).toBe(true);
    expect(unpaid.accessLevel).toBe("full");
    const pastDue = deriveOrgEntitlements(row({ subscriptionStatus: "past_due", pastDueSince: daysAgoIso(GRACE_DAYS + 5) }), daysAgo(400), now, true);
    expect(pastDue.accessLevel).toBe("full");
    expect(pastDue.freeTier).toBe(true);
    expect(deriveOrgEntitlements(row({ subscriptionStatus: "past_due", pastDueSince: daysAgoIso(2) }), daysAgo(400), now, true).freeTier).toBe(false);
  });
  it("the free tier applies only once billing is enforced, and never to a trial, a paying or a founding account", () => {
    const expired = daysAgo(TRIAL_DAYS + 5);
    const off = deriveOrgEntitlements(null, expired, now, false);
    expect(off.rawFreeTier).toBe(true);
    expect(off.freeTier).toBe(false);
    expect(off.accessLevel).toBe("full");
    expect(deriveOrgEntitlements(null, daysAgo(2), now, true).freeTier).toBe(false);
    expect(deriveOrgEntitlements(row({ subscriptionStatus: "active" }), expired, now, true).freeTier).toBe(false);
    expect(deriveOrgEntitlements(row({ billingExempt: true }), expired, now, true).freeTier).toBe(false);
    expect(deriveOrgEntitlements(row({ subscriptionStatus: "past_due", pastDueSince: daysAgoIso(2) }), expired, now, true).freeTier).toBe(false);
  });

  it("an active subscription is full access; the add-on follows the add-on flag", () => {
    const without = deriveOrgEntitlements(row({ subscriptionStatus: "active" }), daysAgo(400), now, true);
    expect(without.state).toBe("active");
    expect(without.accessLevel).toBe("full");
    expect(without.orgAddon).toBe(false);

    const withAddon = deriveOrgEntitlements(row({ subscriptionStatus: "active", orgAddon: true }), daysAgo(400), now, true);
    expect(withAddon.orgAddon).toBe(true);
  });

  it("a removed add-on keeps working until the paid period ends", () => {
    const later = new Date(now.getTime() + 5 * DAY).toISOString();
    const earlier = daysAgoIso(1);
    expect(
      deriveOrgEntitlements(row({ subscriptionStatus: "active", orgAddonUntil: later }), daysAgo(400), now, true).orgAddon
    ).toBe(true);
    expect(
      deriveOrgEntitlements(row({ subscriptionStatus: "active", orgAddonUntil: earlier }), daysAgo(400), now, true).orgAddon
    ).toBe(false);
  });

  it("past_due is full access in grace for GRACE_DAYS, then locked", () => {
    const inGrace = deriveOrgEntitlements(
      row({ subscriptionStatus: "past_due", orgAddon: true, pastDueSince: daysAgoIso(2) }),
      daysAgo(400),
      now,
      true
    );
    expect(inGrace.state).toBe("past_due");
    expect(inGrace.accessLevel).toBe("grace");
    expect(inGrace.orgAddon).toBe(true);
    expect(inGrace.graceDaysLeft).toBe(GRACE_DAYS - 2);

    const locked = deriveOrgEntitlements(
      row({ subscriptionStatus: "past_due", orgAddon: true, pastDueSince: daysAgoIso(GRACE_DAYS + 1) }),
      daysAgo(400),
      now,
      true
    );
    // unpaid past the grace: the free tier, not a lock
    expect(locked.accessLevel).toBe("full");
    expect(locked.freeTier).toBe(true);
    expect(locked.orgAddon).toBe(false);
  });

  it("a canceled subscription is full access until the paid period ends, then lapsed", () => {
    const paidThrough = new Date(now.getTime() + 10 * DAY).toISOString();
    expect(
      deriveOrgEntitlements(row({ subscriptionStatus: "canceled", currentPeriodEnd: paidThrough }), daysAgo(400), now, true).accessLevel
    ).toBe("full");
    const over = deriveOrgEntitlements(
      row({ subscriptionStatus: "canceled", currentPeriodEnd: daysAgoIso(1) }),
      daysAgo(400),
      now,
      true
    );
    expect(over.state).toBe("lapsed");
    expect(over.accessLevel).toBe("full");
    expect(over.freeTier).toBe(true);
  });

  it("an incomplete subscription is treated as no subscription (still on the trial)", () => {
    const e = deriveOrgEntitlements(row({ subscriptionStatus: "incomplete" }), daysAgo(1), now, true);
    expect(e.state).toBe("trial");
  });

  it("with enforcement OFF the effective access is always full, but the raw state still shows", () => {
    const e = deriveOrgEntitlements(row({ subscriptionStatus: "past_due", pastDueSince: daysAgoIso(GRACE_DAYS + 5) }), daysAgo(400), now, false);
    expect(e.rawFreeTier).toBe(true);
    expect(e.freeTier).toBe(false);
    expect(e.rawOrgAddon).toBe(false);
    expect(e.accessLevel).toBe("full");
    expect(e.orgAddon).toBe(true);
    expect(e.enforced).toBe(false);
  });
});
