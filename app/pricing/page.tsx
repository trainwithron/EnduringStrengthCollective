import { HelpShell } from "@/components/support/help-shell";
import { FeeNotice } from "@/components/billing/fee-notice";
import { PLAN_PRICES_CENTS, TRIAL_DAYS } from "@/lib/coach-plan-pricing";
import { feePercentLabel, PAID_OR_TRIAL_FEE_PERCENT } from "@/lib/platform-fee";
import { coachPlanAvailable } from "@/lib/coach-plan-checkout";

// Read when opened: whether the paid plan can be bought yet depends on the environment (Ron's Stripe price).
export const dynamic = "force-dynamic";

export const metadata = { title: "Pricing" };

// What a coach pays Spotlight, readable by anyone, signed in or not (Ron, Nov 20: "the fee notice", on a public page). The fee words are the same ones the app shows where a coach sets up payments
// (lib/platform-fee.ts FEE_NOTICE_LINES, a draft Ron approves).
export default function PricingPage() {
  return (
    <HelpShell title="Pricing" intro="What Spotlight costs a coach, and what it takes from your clients' payments.">
      <div className="space-y-8 max-w-[65ch]">
        <section>
          <h2 className="font-body text-[15px] font-semibold">The plan</h2>
          <p className="font-body text-sm text-chalk mt-2">
            Every new coach starts with {TRIAL_DAYS / 7} weeks free, with no card. After that you choose: the free plan, or the paid plan at ${PLAN_PRICES_CENTS.base / 100} a month{coachPlanAvailable() ? "" : " (coming soon)"}. During the free weeks Spotlight&apos;s fee on client payments is the paid plan&apos;s {feePercentLabel(PAID_OR_TRIAL_FEE_PERCENT)}.
          </p>
        </section>
        <section>
          <h2 className="font-body text-[15px] font-semibold">Fees on your clients&apos; payments</h2>
          <FeeNotice showPricingLink={false} className="mt-2 text-sm" />
        </section>
      </div>
    </HelpShell>
  );
}
