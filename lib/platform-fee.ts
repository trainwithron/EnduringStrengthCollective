// Spotlight's application fee on a client's payment to a coach or gym (Ron, Nov 9). 1% for an organization on a paid plan or its free trial; 5% once it is on the free tier.
// It follows the real plan state (rawFreeTier), never the enforced flag, so the rate is right whether or not billing enforcement is switched on. Stripe's own fee stays with the coach's account.
export const PAID_OR_TRIAL_FEE_PERCENT = 1;
export const FREE_TIER_FEE_PERCENT = 5;

export function platformFeePercent(plan: { rawFreeTier: boolean }): number {
  return plan.rawFreeTier ? FREE_TIER_FEE_PERCENT : PAID_OR_TRIAL_FEE_PERCENT;
}

// The fee on one charge, in whole cents.
export function platformFeeCents(amountCents: number, feePercent: number): number {
  return Math.round((amountCents * feePercent) / 100);
}
