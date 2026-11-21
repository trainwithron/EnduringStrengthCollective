import { redirect } from "next/navigation";
import { createServerClient } from "@/lib/supabase/server";
import { createServiceRoleClient } from "@/lib/supabase/service-role";
import { NoAccess } from "@/components/shared/no-access";
import { PrintButton } from "@/components/shared/print-button";
import { getViewerDisplayTimezone } from "@/lib/display-timezone-server";
import { formatInTimezone } from "@/lib/format-in-timezone";
import { loadDisputeEvidence, money, packageWhat, sessionOutcome } from "@/lib/dispute-evidence";
import { DISPUTE_UPLOAD_LINE } from "@/lib/billing-help";

export const metadata = { title: "Dispute evidence" };

// Evidence for a card dispute, as a page to print or save as a PDF ($6, Ron Nov 20): one payment by one client, with only facts the app holds (lib/dispute-evidence.ts).
// Plain black on white. For a coach of that client only. Nothing is sent to Stripe: the coach uploads it in Stripe's dispute screen themselves.
export default async function DisputeEvidencePage(props: { params: Promise<{ purchaseId: string }> }) {
  const { purchaseId } = await props.params;
  const supabase = await createServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");
  if (!/^[0-9a-f-]{36}$/i.test(purchaseId)) return <NoAccess>That payment isn&apos;t there.</NoAccess>;

  const loaded = await loadDisputeEvidence(supabase, createServiceRoleClient(), { purchaseId, viewerId: user.id });
  if (!loaded.ok) return <NoAccess>{loaded.error}</NoAccess>;
  const e = loaded.evidence;
  const tz = await getViewerDisplayTimezone(supabase, user.id);
  const when = (iso: string | null) => (iso ? formatInTimezone(iso, tz, "dateTime") : "");
  const day = (iso: string | null) => (iso ? formatInTimezone(iso, tz, "date") : "");
  const now = new Date();
  const counts = e.sessions.reduce<Record<string, number>>((acc, s) => {
    const k = sessionOutcome(s, now);
    acc[k] = (acc[k] ?? 0) + 1;
    return acc;
  }, {});

  return (
    <div className="print-sheet bg-white text-black min-h-screen px-8 py-6 font-body">
      <style>{`
        @page { margin: 14mm; }
        @media print {
          html, body { background: #fff !important; }
          .no-print { display: none !important; }
          .print-sheet { padding: 0 !important; }
        }
        .print-block { break-inside: avoid; page-break-inside: avoid; }
        .print-sheet table { width: 100%; border-collapse: collapse; }
        .print-sheet th, .print-sheet td { text-align: left; vertical-align: top; padding: 3px 6px; border-bottom: 1px solid #ccc; font-size: 12px; }
      `}</style>
      <div className="no-print mb-4 space-y-2">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <p className="text-sm text-gray-700">Use Print, then choose &quot;Save as PDF&quot; to keep a copy.</p>
          <div className="flex flex-wrap gap-2">
            <a href={`/api/coach/dispute-evidence?purchaseId=${e.payment.id}`} className="inline-flex items-center h-10 px-4 border border-black text-sm font-medium">
              Download the files (ZIP)
            </a>
            <PrintButton />
          </div>
        </div>
        <p className="text-sm text-gray-700 max-w-[80ch]">{DISPUTE_UPLOAD_LINE}</p>
      </div>

      <header className="border-b border-black pb-2 mb-4">
        <h1 className="text-2xl font-bold">Evidence for a card dispute</h1>
        <p className="text-sm">
          {e.clientName}
          {e.spaceName ? ` · ${e.spaceName}` : ""} · Coach {e.coachName} · Made {day(now.toISOString())} · Times in {tz}
        </p>
        <p className="text-xs text-gray-700 mt-1">Only what Spotlight holds is shown. Sessions and messages run from the payment to {e.windowEndIsNextPayment ? "their next payment" : "today"} ({day(e.windowEnd)}).</p>
        {e.incomplete && <p className="text-sm font-bold mt-1">Some of this could not be read. Open the page again before you use it.</p>}
      </header>

      <section className="print-block mb-5">
        <h2 className="text-sm font-bold uppercase tracking-wide border-b border-gray-400 mb-2">The payment</h2>
        <table>
          <tbody>
            <tr><th>Paid on</th><td>{when(e.payment.createdAt)}</td></tr>
            <tr><th>Amount</th><td>{money(e.payment.amountCents)}</td></tr>
            <tr><th>For</th><td>{packageWhat(e)}</td></tr>
            {e.payment.checkoutId && <tr><th>Checkout reference</th><td>{e.payment.checkoutId}</td></tr>}
          </tbody>
        </table>
      </section>

      <section className="print-block mb-5">
        <h2 className="text-sm font-bold uppercase tracking-wide border-b border-gray-400 mb-2">The package</h2>
        {e.pkg ? (
          <>
            <table>
              <tbody>
                <tr><th>Name</th><td>{e.pkg.name}</td></tr>
                {e.pkg.billingType && <tr><th>Billing</th><td>{e.pkg.billingType === "subscription" ? "Every month" : "One payment"}</td></tr>}
                {e.pkg.sessionsGranted != null && e.pkg.sessionsGranted > 0 && <tr><th>Sessions it gives</th><td>{e.pkg.sessionsGranted}</td></tr>}
                {e.pkg.sessionsPerWeek != null && e.pkg.sessionsPerWeek > 0 && <tr><th>Sessions a week</th><td>{e.pkg.sessionsPerWeek}</td></tr>}
                {e.pkg.priceCents != null && <tr><th>Price today</th><td>{money(e.pkg.priceCents)}</td></tr>}
              </tbody>
            </table>
            <p className="text-xs text-gray-700 mt-1">The package as it is today. The app does not keep a copy of the terms shown at checkout.</p>
          </>
        ) : (
          <p className="text-sm">No package is linked to this payment.</p>
        )}
      </section>

      <section className="print-block mb-5">
        <h2 className="text-sm font-bold uppercase tracking-wide border-b border-gray-400 mb-2">The signed waiver</h2>
        {e.waiver ? (
          <table>
            <tbody>
              {e.waiver.signedName && <tr><th>Signed as</th><td>{e.waiver.signedName}</td></tr>}
              <tr><th>Accepted</th><td>{e.waiver.accepted ? "Yes" : "No"}</td></tr>
              {e.waiver.completedAt && <tr><th>Form completed</th><td>{when(e.waiver.completedAt)}</td></tr>}
              {e.waiver.versions.map((v) => (
                <tr key={v.version + v.acceptedAt}><th>Waiver version {v.version}</th><td>accepted {when(v.acceptedAt)}</td></tr>
              ))}
            </tbody>
          </table>
        ) : (
          <p className="text-sm">No signed waiver on file.</p>
        )}
      </section>

      <section className="mb-5">
        <h2 className="text-sm font-bold uppercase tracking-wide border-b border-gray-400 mb-2">Sessions ({e.sessions.length})</h2>
        {Object.keys(counts).length > 0 && (
          <p className="text-xs text-gray-700 mb-1">{Object.entries(counts).map(([k, n]) => `${k}: ${n}`).join(" · ")}</p>
        )}
        {e.sessions.length === 0 ? (
          <p className="text-sm">No sessions were booked in this time.</p>
        ) : (
          <table>
            <thead>
              <tr><th>Session</th><th>Booked on</th><th>What happened</th></tr>
            </thead>
            <tbody>
              {e.sessions.map((s, i) => (
                <tr key={i}>
                  <td>{when(s.startAt)}</td>
                  <td>{when(s.bookedAt)}</td>
                  <td>{sessionOutcome(s, now)}{s.attendedAt ? ` (${when(s.attendedAt)})` : ""}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>

      <section className="mb-5">
        <h2 className="text-sm font-bold uppercase tracking-wide border-b border-gray-400 mb-2">Messages ({e.messages.length})</h2>
        {e.messages.length === 0 ? (
          <p className="text-sm">No messages in this time.</p>
        ) : (
          <table>
            <thead>
              <tr><th>Sent</th><th>From</th><th>Message</th></tr>
            </thead>
            <tbody>
              {e.messages.map((m, i) => (
                <tr key={i}>
                  <td className="whitespace-nowrap">{when(m.at)}</td>
                  <td>{m.from === "client" ? e.clientName : e.coachName}</td>
                  <td className="whitespace-pre-wrap">{m.text}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>
    </div>
  );
}
