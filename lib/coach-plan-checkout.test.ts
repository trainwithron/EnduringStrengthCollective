import { afterEach, describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { canBuyCoachPlan, coachPlanAvailable, coachPlanPriceId, isLivePlanStatus, planBillingFields, planStatusFor, subscriptionPeriodEnd } from "@/lib/coach-plan-checkout";
import { isPlatformOnlyPurchase } from "@/lib/connect-payee";

// The upgrade path (Ron, Nov 20): a free-tier coach buys the $50 plan. Ron creates the Stripe price himself; the app only reads it.
const read = (p: string) => readFileSync(join(__dirname, "..", p), "utf8").replace(/\r\n/g, "\n");
const env = { ...process.env };
afterEach(() => {
  process.env = { ...env };
});

describe("whether the plan can be bought", () => {
  it("only once Stripe is set up and Ron's price is named", () => {
    delete process.env.STRIPE_PRICE_COACH_PLAN;
    process.env.STRIPE_SECRET_KEY = "sk_test_x";
    expect(coachPlanPriceId()).toBeNull();
    expect(coachPlanAvailable()).toBe(false);
    process.env.STRIPE_PRICE_COACH_PLAN = "  price_123 ";
    expect(coachPlanPriceId()).toBe("price_123");
    expect(coachPlanAvailable()).toBe(true);
    delete process.env.STRIPE_SECRET_KEY;
    expect(coachPlanAvailable()).toBe(false);
  });
  it("by an organization that is not exempt and not already paying", () => {
    for (const state of ["trial", "trial_expired", "lapsed"] as const) expect(canBuyCoachPlan({ state })).toBe(true);
    for (const state of ["exempt", "active", "past_due", "canceled"] as const) expect(canBuyCoachPlan({ state })).toBe(false);
  });
});

describe("what the webhook writes on the organization's billing row", () => {
  it("the status, the paid-through date, and when a payment first became past due", () => {
    const now = new Date("2026-11-20T12:00:00Z");
    expect(planBillingFields("active", "2026-12-20T00:00:00.000Z", "2026-11-01T00:00:00Z", now)).toEqual({ subscription_status: "active", current_period_end: "2026-12-20T00:00:00.000Z", past_due_since: null });
    expect(planBillingFields("past_due", null, null, now).past_due_since).toBe(now.toISOString());
    expect(planBillingFields("past_due", null, "2026-11-15T00:00:00Z", now).past_due_since).toBe("2026-11-15T00:00:00Z");
  });
  it("only statuses the row allows; a deleted subscription is canceled", () => {
    expect(planStatusFor("customer.subscription.updated", "active")).toBe("active");
    expect(planStatusFor("customer.subscription.updated", "unpaid")).toBe("unpaid");
    expect(planStatusFor("customer.subscription.deleted", "active")).toBe("canceled");
    expect(planStatusFor("customer.subscription.updated", "something_new")).toBeNull();
  });
  it("the period end from the item (newer Stripe) or the subscription", () => {
    expect(subscriptionPeriodEnd({ items: { data: [{ current_period_end: 1766188800 }] } })).toBe("2025-12-20T00:00:00.000Z");
    expect(subscriptionPeriodEnd({ current_period_end: 1766188800 })).toBe("2025-12-20T00:00:00.000Z");
    expect(subscriptionPeriodEnd({})).toBeNull();
  });
});

describe("the checkout", () => {
  const route = read("app/api/stripe/plan-checkout/route.ts");
  it("only the owner, only with Ron's price; never creates a price or a product", () => {
    expect(route).toContain('if ((membership as { role?: string } | null)?.role !== "owner")');
    expect(route).toContain("if (!isStripeConfigured() || !priceId) return NextResponse.json({ error: \"The paid plan isn't available yet.\" }, { status: 503 });");
    expect(route).not.toMatch(/prices\.create|products\.create/);
    expect(route).toContain("line_items: [{ price: priceId, quantity: 1 }],");
  });
  it("refuses an exempt organization and one already paying", () => {
    expect(route).toContain('if (plan.state === "exempt")');
    expect(route).toContain("if (!canBuyCoachPlan(plan))");
  });
  it("is a subscription on Spotlight's own account, tagged for the webhook", () => {
    expect(route).toContain('mode: "subscription",');
    expect(route).toContain("subscription_data: { metadata },");
    expect(route).not.toContain("stripeAccount");
    expect(isPlatformOnlyPurchase("coach_plan")).toBe(true);
  });
  it("does not touch billing enforcement", () => {
    expect(route).not.toContain("COACH_BILLING_ENFORCED");
    expect(read("lib/coach-plan-checkout.ts")).not.toMatch(/process\.env\.COACH_BILLING_ENFORCED/);
  });
});

describe("the webhook moves the organization to paid", () => {
  const hook = read("app/api/stripe/webhook/route.ts");
  it("when the checkout completes, from the subscription Stripe made", () => {
    expect(hook).toContain("if (purchaseKind === COACH_PLAN_PURCHASE_KIND) {");
    expect(hook).toContain("const planSubscription = await stripe.subscriptions.retrieve(session.subscription);");
    expect(hook).toContain("stripe_subscription_id: planSubscription.id,");
    expect(hook).toContain("if (planError) throw planError;");
  });
  it("and follows the subscription afterwards, ignoring one that is not the organization's current subscription", () => {
    expect(hook).toContain("if (row?.stripe_subscription_id && row.stripe_subscription_id !== subscription.id) break;");
    expect(hook).toContain("if (subscription.metadata?.purchase_kind === COACH_PLAN_PURCHASE_KIND) break;");
  });
  it("the buttons: the paid plan where an owner on the free plan sets up payments, and on Plan & Billing", () => {
    expect(read("components/billing/plan-upgrade-button.tsx")).toContain('{!available ? "Paid plan: not available yet"');
    expect(read("app/(coach)/groups/[groupId]/business/packages/page.tsx")).toContain("upgrade={{ organizationId: group.organization_id, available: coachPlanAvailable() }}");
    expect(read("components/coach/desktop/plan-billing-panel.tsx")).toContain("{isOwner && organizationId && canBuyCoachPlan(e) && (");
  });
});

describe("never two plans for one organization (Assistant review of 5db6fa62)", () => {
  const route = read("app/api/stripe/plan-checkout/route.ts");
  const hook = read("app/api/stripe/webhook/route.ts");
  it("a plan Stripe already has stops a new checkout, and another open checkout is closed first", () => {
    expect(route).toContain('const existing = await stripe.subscriptions.list({ customer: customerId, price: priceId, status: "all", limit: 20 });');
    expect(route).toContain("const live = existing.data.filter((s) => isLivePlanStatus(s.status));");
    expect(route).toContain('if (live.length > 0) return NextResponse.json({ error: "This organization already has a plan." }, { status: 409 });');
    // an unfinished first payment (the bank's check left open) says what to do instead
    expect(route).toContain('if (live.length > 0 && live.every((s) => s.status === "incomplete"))');
    expect(route).toContain("or try again tomorrow");
    expect(route).toContain("if (s.metadata?.purchase_kind === COACH_PLAN_PURCHASE_KIND) await stripe.checkout.sessions.expire(s.id);");
    expect(route).toContain("{ idempotencyKey: `coach-plan-customer-${organizationId}` }");
  });
  it("a second paid plan never replaces the first: the platform admin is told to refund it", () => {
    expect(hook).toContain("if (held?.stripe_subscription_id && held.stripe_subscription_id !== planSubscription.id && isLivePlanStatus(held.subscription_status)) {");
    expect(hook).toContain('await alertPlatformAdmins(\n              "A coach plan was paid twice",');
  });
  it("which statuses count as a live plan", () => {
    for (const s of ["active", "trialing", "past_due", "incomplete", "unpaid", "paused"]) expect(isLivePlanStatus(s)).toBe(true);
    for (const s of ["canceled", "incomplete_expired", null, ""]) expect(isLivePlanStatus(s)).toBe(false);
  });
  it("the pricing page says the paid plan is coming until it can be bought; buying in the free weeks says it charges at once", () => {
    expect(read("app/pricing/page.tsx")).toContain('{coachPlanAvailable() ? "" : " (coming soon)"}');
    expect(read("components/billing/plan-upgrade-button.tsx")).toContain("today and ends your free weeks.");
  });
});
