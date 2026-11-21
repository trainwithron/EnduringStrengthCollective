import { createServerClient } from "@/lib/supabase/server";
import { getViewerDisplayTimezone } from "@/lib/display-timezone-server";
import { clientFailedPaymentLine, loadFailedPayment } from "@/lib/payment-failed";
import { ManageBillingLink } from "@/components/athlete/manage-billing-link";

// On a client's Home, while their monthly card payment has failed and Stripe is still trying it ($5, Ron Nov 20): one friendly line and a button to update the card in
// their coach's billing page (the same Stripe page as Settings > Billing > Manage billing). It only informs: nothing is blocked or paused. Not shown otherwise.
export async function PaymentFailedNotice({ groupId, athleteId }: { groupId: string; athleteId: string }) {
  const supabase = await createServerClient();
  const failed = await loadFailedPayment(supabase, { athleteId, groupId });
  if (!failed) return null;
  const timeZone = await getViewerDisplayTimezone(supabase, athleteId);
  return (
    <section aria-label="Card payment" className="tint-alert rounded-card px-4 py-3" data-payment-failed-notice>
      <p className="font-display font-semibold text-lg leading-tight text-chalk">Your card needs a look</p>
      <p className="font-body text-sm text-steel mt-1">{clientFailedPaymentLine(failed, timeZone)}</p>
      <div className="mt-2">
        <ManageBillingLink
          groupId={groupId}
          label="Update my card"
          className="min-h-11 px-4 rounded-token-pill border border-rust/50 font-body text-sm font-semibold text-rust-ink disabled:opacity-40"
        />
      </div>
    </section>
  );
}
