import { createServerClient } from "@/lib/supabase/server";
import { formatInTimezone } from "@/lib/format-in-timezone";
import Link from "next/link";
import { chunk } from "@/lib/chunk";
import { addSessionsHref } from "@/lib/add-sessions-link";
import { OpenStripeButton } from "@/components/coach/open-stripe-button";

// A short note for a client whose card failed, opened in the message box for the coach to edit and send (audit, Nov 21).
export function failedCardDraft(firstName: string): string {
  const name = firstName.trim() || "there";
  return `Hi ${name}, a quick heads-up: your last card payment didn't go through. Could you update your card when you get a chance? Thanks!`;
}

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

export const LIMIT = 25;
// Only a database that does not have the table yet (the paste is pending) may show nothing; any other failure is said.
const TABLE_MISSING = new Set(["42P01", "PGRST205"]);

interface EventRow {
  id: string;
  kind: string;
  group_id: string | null;
  athlete_id: string | null;
  amount_cents: number | null;
  total_cents: number | null;
  currency: string | null;
  detail: string | null;
  created_at: string;
}

// The money problems of the last 90 days for the groups this page counts (Release M1): a failed payment, a refund made in Stripe, a dispute. The groups are the same ones the page's numbers cover (a coach's own groups; for an
// owner or admin the whole organization, which the database lets them read). A record only: nothing here changes a balance or ends anyone's access. Not shown when there is nothing to show or the record is not there yet.
export async function PaymentProblemsSection({ groupIds, timezone }: { groupIds: string[]; timezone: string }) {
  if (groupIds.length === 0) return null;
  const supabase = await createServerClient();
  const since = new Date(Date.now() - 90 * 86400000).toISOString();
  const events: EventRow[] = [];
  let failed = false;
  let missing = false;
  // Groups of 100 ids, a few at a time; each group answers its own newest LIMIT, and the newest LIMIT of all of them are kept.
  const groups = chunk([...new Set(groupIds)], 100);
  for (let i = 0; i < groups.length; i += 4) {
    const results = await Promise.all(
      groups.slice(i, i + 4).map((g) =>
        supabase.from("payment_events").select("id, kind, group_id, athlete_id, amount_cents, total_cents, currency, detail, created_at").in("group_id", g).gte("created_at", since).order("created_at", { ascending: false }).limit(LIMIT)
      )
    );
    for (const r of results) {
      if (r.error) {
        if (TABLE_MISSING.has((r.error as { code?: string }).code ?? "")) missing = true;
        else failed = true;
      } else events.push(...((r.data ?? []) as EventRow[]));
    }
  }
  if (failed) {
    return (
      <p className="font-body text-sm text-rust-ink mb-8" role="alert">
        Couldn&apos;t load payment problems. Reload to try again.
      </p>
    );
  }
  if (missing || events.length === 0) return null;
  events.sort((a, b) => b.created_at.localeCompare(a.created_at));
  const capped = events.length > LIMIT || events.length === LIMIT;
  const shown = events.slice(0, LIMIT);

  const ids = [...new Set(shown.map((e) => e.athlete_id).filter((x): x is string => !!x))];
  const { data: people, error: peopleError } = ids.length > 0 ? await supabase.from("profiles").select("id, full_name").in("id", ids) : { data: [], error: null };
  const names = new Map(((people ?? []) as { id: string; full_name: string | null }[]).map((p) => [p.id, p.full_name ?? "A client"]));
  const money = (cents: number | null, currency: string | null) => (cents == null ? "" : (cents / 100).toLocaleString("en-US", { style: "currency", currency: (currency ?? "usd").toUpperCase() }));

  return (
    <section aria-label="Payment problems" className="mb-8">
      <h2 className="font-display uppercase text-sm tracking-wide text-steel mb-2">Payment problems, last 90 days</h2>
      <ul className="border border-steel/20 divide-y divide-steel/15">
        {shown.map((e) => {
          const name = e.athlete_id && !peopleError ? names.get(e.athlete_id) ?? null : null;
          const first = name ? name.trim().split(/\s+/)[0] ?? "" : "";
          // Who it is about, where they are: the name opens their profile, and each kind gets its next step right on the row (audit, Nov 21).
          const client = e.athlete_id && e.group_id ? { groupId: e.group_id, athleteId: e.athlete_id } : null;
          return (
          <li key={e.id} className="p-3 font-body text-sm">
            <p className="text-chalk">
              <strong>{LABEL[e.kind] ?? e.kind}</strong>
              {e.athlete_id ? " · " : ""}
              {e.athlete_id && client ? (
                <Link prefetch={false} href={`/groups/${client.groupId}/athletes/${client.athleteId}`} className="underline underline-offset-2 hover:text-rust-ink">
                  {name ?? "A client"}
                </Link>
              ) : e.athlete_id ? (
                name ?? "A client"
              ) : null}
              {money(e.amount_cents, e.currency) ? ` · ${money(e.amount_cents, e.currency)}` : ""}
              {e.kind === "refund" && e.total_cents != null && e.total_cents !== e.amount_cents ? ` (${money(e.total_cents, e.currency)} refunded in total)` : ""}
              {e.detail ? ` · ${e.detail}` : ""}
            </p>
            <p className="text-xs text-steel">
              {formatInTimezone(e.created_at, timezone, "date")}
              {HELP[e.kind] ? ` · ${HELP[e.kind]}` : ""}
            </p>
            {client && e.kind === "payment_failed" && (
              <Link prefetch={false} href={`/groups/${client.groupId}/messages/${client.athleteId}?draft=${encodeURIComponent(failedCardDraft(first))}`} className="inline-flex items-center min-h-11 font-body text-sm font-semibold text-rust-ink hover:underline underline-offset-2">
                {first ? `Message ${first}` : "Message them"}
              </Link>
            )}
            {client && e.kind === "refund" && (
              <Link prefetch={false} href={addSessionsHref(client.groupId, client.athleteId)} className="inline-flex items-center min-h-11 font-body text-sm font-semibold text-rust-ink hover:underline underline-offset-2">
                Add sessions
              </Link>
            )}
            {e.group_id && e.kind === "dispute_opened" && <OpenStripeButton groupId={e.group_id} />}
          </li>
          );
        })}
      </ul>
      {capped && <p className="font-body text-xs text-steel mt-2">Showing the latest {LIMIT}.</p>}
    </section>
  );
}
