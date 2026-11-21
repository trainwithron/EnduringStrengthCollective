import Link from "next/link";
import { createServerClient } from "@/lib/supabase/server";
import { coachFailedPaymentLine, loadFailedPayment } from "@/lib/payment-failed";
import { DISPUTE_UPLOAD_LINE, PAUSE_CLIENT_LINE } from "@/lib/billing-help";
import { formatInTimezone } from "@/lib/format-in-timezone";
import { money } from "@/lib/dispute-evidence";

const PAYMENTS_SHOWN = 12;

// Under Billing on a client's profile (Ron, Nov 20): a failed card payment and what Stripe does next ($5), how to pause the client with today's tools ($4), and their card
// payments, each with Evidence for a dispute ($6). Read as the signed-in coach (row security decides what shows). Nothing here changes anything.
export async function ClientBillingFacts({ groupId, athleteId, timeZone }: { groupId: string; athleteId: string; timeZone: string }) {
  const supabase = await createServerClient();
  const [failed, { data: payments, error: paymentsError }] = await Promise.all([
    loadFailedPayment(supabase, { athleteId, groupId }),
    supabase.from("credit_purchases").select("id, created_at, amount_cents, credits_purchased").eq("athlete_id", athleteId).eq("group_id", groupId).order("created_at", { ascending: false }).limit(PAYMENTS_SHOWN),
  ]);
  const rows = (payments ?? []) as { id: string; created_at: string; amount_cents: number; credits_purchased: number }[];

  return (
    <div className="space-y-3 mb-4" data-client-billing-facts>
      {failed && (
        <div className="tint-alert rounded-card px-4 py-3" role="status" data-payment-failed>
          <p className="font-body text-sm font-semibold text-chalk">Payment failed</p>
          <p className="font-body text-sm text-steel mt-0.5">{coachFailedPaymentLine(failed, timeZone)}</p>
        </div>
      )}
      <p className="font-body text-xs text-steel max-w-[70ch]" data-pause-help>
        {PAUSE_CLIENT_LINE}
      </p>
      {paymentsError ? (
        <p className="font-body text-xs text-rust-ink" role="alert">
          Couldn&apos;t load their card payments. Reload to try again.
        </p>
      ) : (
        rows.length > 0 && (
          <div className="bg-surface rounded-card px-4 py-3">
            <p className="font-body text-xs text-steel uppercase tracking-wide">Card payments</p>
            <ul className="mt-1 divide-y divide-steel/15">
              {rows.map((p) => (
                <li key={p.id} className="py-2 flex flex-wrap items-center justify-between gap-2 font-body text-sm">
                  <span className="text-chalk">
                    {formatInTimezone(p.created_at, timeZone, "date")} · {money(p.amount_cents)}
                    {p.credits_purchased > 0 ? <span className="text-steel"> · {p.credits_purchased} session{p.credits_purchased === 1 ? "" : "s"}</span> : null}
                  </span>
                  <Link href={`/print/dispute-evidence/${p.id}`} className="min-h-11 inline-flex items-center text-rust-ink text-sm" target="_blank" rel="noopener">
                    Evidence for a dispute
                  </Link>
                </li>
              ))}
            </ul>
            <p className="font-body text-xs text-steel mt-2 max-w-[70ch]">{DISPUTE_UPLOAD_LINE}</p>
          </div>
        )
      )}
    </div>
  );
}
