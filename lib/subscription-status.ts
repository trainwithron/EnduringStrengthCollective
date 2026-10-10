// How a Stripe subscription status is stored and treated. A subscription that has ended for good (canceled, unpaid, or one whose first payment never completed) is LAPSED: it counts
// as canceled and the group access it gave ends. past_due is a grace period: Stripe is still retrying the payment, so nothing is taken away. A paid invoice gives access back.
export const STORED_STATUSES = ["active", "past_due", "canceled", "incomplete", "paused"] as const;
export type StoredSubscriptionStatus = (typeof STORED_STATUSES)[number];

const LAPSED_STRIPE_STATUSES = ["canceled", "unpaid", "incomplete_expired"];

// The status to store for this event, or null to leave the row alone (a status this app does not model, such as trialing).
export function storedSubscriptionStatus(eventType: string, stripeStatus: string): StoredSubscriptionStatus | null {
  if (eventType === "customer.subscription.deleted") return "canceled";
  if (LAPSED_STRIPE_STATUSES.includes(stripeStatus)) return "canceled";
  return (STORED_STATUSES as readonly string[]).includes(stripeStatus) ? (stripeStatus as StoredSubscriptionStatus) : null;
}

// Group access given by the package ends when the subscription lapses; never during the past_due grace.
export function endsGroupAccess(stored: StoredSubscriptionStatus): boolean {
  return stored === "canceled";
}
