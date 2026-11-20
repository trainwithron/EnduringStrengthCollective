// Buying the coach plan (Ron, Nov 20: "add the upgrade path"): a free-tier organization's owner pays Spotlight for the $50/mo plan on Spotlight's own Stripe account, and the webhook moves the
// organization to paid. The Stripe price is created by Ron in his Stripe dashboard (never by the app or the CLI) and named here through the environment; until it is set the button says the plan is
// not available yet. Billing enforcement (COACH_BILLING_ENFORCED) is not touched: buying the plan only changes the organization's real plan state, so its fee drops to the paid rate.
import type { OrgEntitlements } from "@/lib/org-entitlements";

export const COACH_PLAN_PURCHASE_KIND = "coach_plan";

export function coachPlanPriceId(): string | null {
  const id = process.env.STRIPE_PRICE_COACH_PLAN?.trim();
  return id ? id : null;
}

/** Whether the plan can be bought at all right now (Stripe set up and Ron's price named). */
export function coachPlanAvailable(): boolean {
  return !!process.env.STRIPE_SECRET_KEY && !!coachPlanPriceId();
}

/** An organization that can buy the plan: not billing-exempt, and not already paying (or paid through the end of a canceled period, or in a payment's grace period). */
export function canBuyCoachPlan(e: Pick<OrgEntitlements, "state">): boolean {
  return e.state === "trial" || e.state === "trial_expired" || e.state === "lapsed";
}

/** The current period's end on a subscription (newer Stripe API versions keep it on each item). */
export function subscriptionPeriodEnd(subscription: { items?: { data?: { current_period_end?: number | null }[] } | null; current_period_end?: number | null }): string | null {
  const unix = subscription.items?.data?.[0]?.current_period_end ?? subscription.current_period_end ?? null;
  return unix ? new Date(unix * 1000).toISOString() : null;
}

/** The plan row for a subscription's status: past_due keeps the moment it first became past due (the grace period counts from there); anything else clears it. */
export function planBillingFields(
  status: string,
  periodEnd: string | null,
  previousPastDueSince: string | null,
  now: Date = new Date()
): { subscription_status: string; current_period_end: string | null; past_due_since: string | null } {
  return {
    subscription_status: status,
    current_period_end: periodEnd,
    past_due_since: status === "past_due" ? previousPastDueSince ?? now.toISOString() : null,
  };
}

// The Stripe statuses the organization_billing row stores (its check constraint).
export const PLAN_STATUSES = ["trialing", "active", "past_due", "canceled", "incomplete", "incomplete_expired", "unpaid", "paused"] as const;
export function planStatusFor(eventType: string, stripeStatus: string): string | null {
  if (eventType === "customer.subscription.deleted") return "canceled";
  return (PLAN_STATUSES as readonly string[]).includes(stripeStatus) ? stripeStatus : null;
}
