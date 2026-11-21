// Spotlight's application fee on a client's payment to a coach or gym (Ron, Nov 9; Nov 20: "keep the 5%, add the upgrade path and fee notice and 0.5% fee for the paid memberships"). 0.5% for an
// organization on a paid plan, its free trial, or billing-exempt; 5% once it is on the free tier. It follows the real plan state (rawFreeTier), never the enforced flag, so the rate is right whether
// or not billing enforcement is switched on. Stripe's own fee stays with the coach's account. Stripe takes a decimal application_fee_percent (up to two places).
import { PLAN_PRICES_CENTS } from "@/lib/coach-plan-pricing";

export const PAID_OR_TRIAL_FEE_PERCENT = 0.5;
export const FREE_TIER_FEE_PERCENT = 5;

export function platformFeePercent(plan: { rawFreeTier: boolean }): number {
  return plan.rawFreeTier ? FREE_TIER_FEE_PERCENT : PAID_OR_TRIAL_FEE_PERCENT;
}

// The fee on one charge, in whole cents (half a cent and up rounds up: 0.5% of $1.00 is 1 cent; under a dollar at 0.5% it can be 0).
export function platformFeeCents(amountCents: number, feePercent: number): number {
  return Math.round((amountCents * feePercent) / 100);
}

/** "0.5%", "5%". */
export function feePercentLabel(percent: number): string {
  return `${Number(percent.toFixed(2))}%`;
}

// The monthly client payments at which the paid plan's lower fee pays for the plan itself: (5% - 0.5%) of R = $50, so R = $1,111.11. Said as "about $1,100".
export function breakEvenMonthlyCents(): number {
  return Math.round(PLAN_PRICES_CENTS.base / ((FREE_TIER_FEE_PERCENT - PAID_OR_TRIAL_FEE_PERCENT) / 100));
}

/** "$1,100": the break-even rounded down to the nearest hundred, for a sentence that says "about". */
export function breakEvenLabel(): string {
  const dollars = Math.floor(breakEvenMonthlyCents() / 100 / 100) * 100;
  return `$${dollars.toLocaleString("en-US")}`;
}

// What a coach pays, in plain words, wherever they set up payments, on Plan & Billing and on the public pricing page (wording approved by Ron, Nov 20).
export const FEE_NOTICE_LINES: string[] = [
  `Free plan: Spotlight takes ${feePercentLabel(FREE_TIER_FEE_PERCENT)} of each client payment, plus Stripe's own fee.`,
  `Paid plan ($${PLAN_PRICES_CENTS.base / 100}/mo): ${feePercentLabel(PAID_OR_TRIAL_FEE_PERCENT)}.`,
  `The paid plan saves you money once your clients pay you more than about ${breakEvenLabel()} a month.`,
  "Stripe also charges 0.7% on subscription payments. Your Stripe account is yours.",
];
