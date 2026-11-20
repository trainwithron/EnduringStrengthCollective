import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { breakEvenLabel, breakEvenMonthlyCents, FEE_NOTICE_LINES, feePercentLabel, FREE_TIER_FEE_PERCENT, PAID_OR_TRIAL_FEE_PERCENT, platformFeeCents, platformFeePercent } from "@/lib/platform-fee";
import { deriveOrgEntitlements, type OrgBillingRow } from "@/lib/org-entitlements";

// Ron, Nov 20: "keep the 5%, add the upgrade path and fee notice and 0.5% fee for the paid memberships".
const read = (p: string) => readFileSync(join(__dirname, "..", p), "utf8").replace(/\r\n/g, "\n");
const now = new Date("2026-11-09T12:00:00Z");
const longAgo = new Date("2026-01-01T00:00:00Z");
const row = (over: Partial<OrgBillingRow>): OrgBillingRow => ({ billingExempt: false, trialEndsAt: null, subscriptionStatus: null, currentPeriodEnd: null, orgAddon: false, orgAddonUntil: null, pastDueSince: null, ...over });
const percentFor = (r: OrgBillingRow | null, created: Date, enforced = false) => platformFeePercent(deriveOrgEntitlements(r, created, now, enforced));

describe("the platform fee on a client's payment", () => {
  it("the two rates are 0.5% and 5%", () => {
    expect(PAID_OR_TRIAL_FEE_PERCENT).toBe(0.5);
    expect(FREE_TIER_FEE_PERCENT).toBe(5);
  });
  it("a free trial pays 0.5%", () => {
    expect(percentFor(row({ trialEndsAt: "2026-12-01T00:00:00Z" }), longAgo)).toBe(0.5);
    expect(percentFor(null, new Date("2026-11-08T00:00:00Z"))).toBe(0.5);
  });
  it("a paid plan pays 0.5%, and so does a payment still in its grace period", () => {
    expect(percentFor(row({ subscriptionStatus: "active" }), longAgo)).toBe(0.5);
    expect(percentFor(row({ subscriptionStatus: "past_due", pastDueSince: "2026-11-08T00:00:00Z" }), longAgo)).toBe(0.5);
  });
  it("an exempt organization pays 0.5% (all four live organizations are exempt)", () => {
    expect(percentFor(row({ billingExempt: true }), longAgo)).toBe(0.5);
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
  it("works out whole cents, small amounts included", () => {
    expect(platformFeeCents(10000, 0.5)).toBe(50);
    expect(platformFeeCents(10000, 5)).toBe(500);
    // half a cent rounds up; below that it is nothing
    expect(platformFeeCents(100, 0.5)).toBe(1);
    expect(platformFeeCents(99, 0.5)).toBe(0);
    expect(platformFeeCents(299, 0.5)).toBe(1);
    expect(platformFeeCents(300, 0.5)).toBe(2);
    expect(Number.isInteger(platformFeeCents(12345, 0.5))).toBe(true);
  });
  it("a renewal is charged at the organization's rate when it is billed, so a subscription started at 1% moves to 0.5% at its next invoice", () => {
    const hook = read("app/api/stripe/webhook/route.ts");
    expect(hook).toContain('case "invoice.created": {');
    expect(hook).toContain("const feeCents = platformFeeCents(invoice.amount_due ?? 0, await feePercentForOrg(supabase, payee.organizationId));");
    expect(hook).toContain("await eventStripe.invoices.update(invoice.id!, { application_fee_amount: feeCents });");
    // a new subscription carries the decimal percent itself
    expect(read("app/api/stripe/checkout/route.ts")).toContain("{ application_fee_percent: feePercent,");
  });
});

describe("the fee notice", () => {
  it("says both rates, the break-even and Stripe's own subscription fee", () => {
    expect(feePercentLabel(0.5)).toBe("0.5%");
    expect(feePercentLabel(5)).toBe("5%");
    // 4.5% of R = $50 -> R = $1,111.11
    expect(breakEvenMonthlyCents()).toBe(111111);
    expect(breakEvenLabel()).toBe("$1,100");
    expect(FEE_NOTICE_LINES).toEqual([
      "Free plan: Spotlight takes 5% of each client payment, plus Stripe's own fee.",
      "Paid plan ($50/mo): 0.5%.",
      "The paid plan saves you money once your clients pay you more than about $1,100 a month.",
      "Stripe also charges 0.7% on subscription payments. Your Stripe account is yours.",
    ]);
  });
  it("is where payments are set up (with the upgrade beside it for an owner on the free plan), on Plan & Billing, and on a public page", () => {
    const connect = read("components/coach/desktop/stripe-connect-panel.tsx");
    expect(connect).toContain('<FeeNotice currentPercent={feePercent} className="mt-3" />');
    expect(connect).toContain("{isOwner && upgrade && feePercent === FREE_TIER_FEE_PERCENT && (");
    expect(connect).not.toContain("{feePercent}%");
    expect(read("components/coach/desktop/plan-billing-panel.tsx")).toContain("<FeeNotice currentPercent={platformFeePercent(e)} />");
    expect(read("app/pricing/page.tsx")).toContain("<FeeNotice showPricingLink={false}");
    expect(read("lib/supabase/middleware.ts")).toContain('pathname === "/pricing" ||');
    expect(read("lib/legal-status.ts")).toContain('"/pricing"');
  });
});
