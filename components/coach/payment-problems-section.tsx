import { createServerClient } from "@/lib/supabase/server";
import { formatInTimezone } from "@/lib/format-in-timezone";

const LABEL: Record<string, string> = {
  payment_failed: "Payment failed",
  refund: "Refunded in Stripe",
  dispute_opened: "Disputed with their bank",
  dispute_closed: "Dispute closed",
};
const HELP: Record<string, string> = {
  payment_failed: "Stripe will try the card again. Ask them to update it if it keeps failing.",
  refund: "Their sessions were not changed here. Adjust them yourself if you want them to match.",
  dispute_opened: "Answer it in your Stripe dashboard before the deadline.",
  dispute_closed: "",
};

// The money problems of the last 90 days for this group (Release M1): a failed payment, a refund made in Stripe, a dispute. A record only: nothing here changes a balance or ends anyone's access. Not shown when there is
// nothing to show, or when the record is not there yet.
export async function PaymentProblemsSection({ groupId, timezone }: { groupId: string; timezone: string }) {
  const supabase = await createServerClient();
  const since = new Date(Date.now() - 90 * 86400000).toISOString();
  const { data, error } = await supabase
    .from("payment_events")
    .select("id, kind, athlete_id, amount_cents, currency, detail, created_at")
    .eq("group_id", groupId)
    .gte("created_at", since)
    .order("created_at", { ascending: false })
    .limit(25);
  if (error || !data || data.length === 0) return null;
  const events = data as { id: string; kind: string; athlete_id: string | null; amount_cents: number | null; currency: string | null; detail: string | null; created_at: string }[];
  const ids = [...new Set(events.map((e) => e.athlete_id).filter((x): x is string => !!x))];
  const { data: people } = ids.length > 0 ? await supabase.from("profiles").select("id, full_name").in("id", ids) : { data: [] };
  const names = new Map(((people ?? []) as { id: string; full_name: string | null }[]).map((p) => [p.id, p.full_name ?? "A client"]));
  const money = (e: { amount_cents: number | null; currency: string | null }) =>
    e.amount_cents == null ? "" : (e.amount_cents / 100).toLocaleString("en-US", { style: "currency", currency: (e.currency ?? "usd").toUpperCase() });

  return (
    <section aria-label="Payment problems" className="mb-8">
      <h2 className="font-display uppercase text-sm tracking-wide text-steel mb-2">Payment problems, last 90 days</h2>
      <ul className="border border-steel/20 divide-y divide-steel/15">
        {events.map((e) => (
          <li key={e.id} className="p-3 font-body text-sm">
            <p className="text-chalk">
              <strong>{LABEL[e.kind] ?? e.kind}</strong>
              {e.athlete_id ? ` · ${names.get(e.athlete_id) ?? "A client"}` : ""}
              {money(e) ? ` · ${money(e)}` : ""}
              {e.detail ? ` · ${e.detail}` : ""}
            </p>
            <p className="text-xs text-steel">
              {formatInTimezone(e.created_at, timezone, "date")}
              {HELP[e.kind] ? ` · ${HELP[e.kind]}` : ""}
            </p>
          </li>
        ))}
      </ul>
    </section>
  );
}
