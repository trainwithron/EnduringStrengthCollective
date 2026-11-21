import { redirect } from "next/navigation";
import { createServerClient } from "@/lib/supabase/server";
import { NoAccess } from "@/components/shared/no-access";
import { PrintButton } from "@/components/shared/print-button";
import { formatInTimezone } from "@/lib/format-in-timezone";
import { dateKeyInZone } from "@/lib/timezone";
import { money, type SavedPayrollReport } from "@/lib/payroll-report";

export const metadata = { title: "Saved pay period" };

// One saved pay period ($3, Ron Nov 20), reopened exactly as it was saved, to read, print or save as a PDF. Read only. Row security lets only the organization's owner and
// admins read it (migration 0464); anyone else is told it is not there.
export default async function SavedPayPeriodPage(props: { params: Promise<{ reportId: string }> }) {
  const { reportId } = await props.params;
  const supabase = await createServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");
  if (!/^[0-9a-f-]{36}$/i.test(reportId)) return <NoAccess>That pay period isn&apos;t there.</NoAccess>;

  const { data, error } = await supabase.from("payroll_reports").select("id, created_at, created_by, from_day, to_day, time_zone, note, snapshot").eq("id", reportId).maybeSingle();
  if (error) return <NoAccess>That pay period couldn&apos;t be loaded right now. Try again in a moment.</NoAccess>;
  if (!data) return <NoAccess>That pay period isn&apos;t there, or only the owner and admins can see it.</NoAccess>;
  const r = data as SavedPayrollReport;
  const s = r.snapshot;
  const tz = s.period.timeZone;
  const { data: savedBy } = r.created_by ? await supabase.from("profiles").select("full_name").eq("id", r.created_by).maybeSingle() : { data: null };

  return (
    <div className="print-sheet bg-white text-black min-h-screen px-8 py-6 font-body">
      <style>{`
        @page { margin: 12mm; }
        @media print {
          html, body { background: #fff !important; }
          .no-print { display: none !important; }
          .print-sheet { padding: 0 !important; }
        }
        .print-sheet table { width: 100%; border-collapse: collapse; }
        .print-sheet th, .print-sheet td { text-align: left; vertical-align: top; padding: 3px 6px; border-bottom: 1px solid #ccc; font-size: 12px; }
        .print-sheet td.num, .print-sheet th.num { text-align: right; font-variant-numeric: tabular-nums; }
      `}</style>
      <div className="no-print flex flex-wrap items-center justify-between gap-3 mb-4">
        <p className="text-sm text-gray-700">Use Print, then choose &quot;Save as PDF&quot; to keep a copy.</p>
        <div className="flex flex-wrap gap-2">
          <a href={`/api/coach/payroll-reports/${r.id}/csv`} className="inline-flex items-center h-10 px-4 border border-black text-sm font-medium">
            Download (spreadsheet)
          </a>
          <PrintButton />
        </div>
      </div>

      <header className="border-b border-black pb-2 mb-4">
        <h1 className="text-2xl font-bold">Pay period {s.period.fromDay} to {s.period.toDay}</h1>
        <p className="text-sm">
          Saved {formatInTimezone(r.created_at, tz, "dateTime")}
          {(savedBy as { full_name?: string | null } | null)?.full_name ? ` by ${(savedBy as { full_name: string }).full_name}` : ""} · Days run midnight to midnight in {tz}
        </p>
        {r.note && <p className="text-sm mt-1"><span className="font-semibold">Note: </span>{r.note}</p>}
        <p className="text-xs text-gray-700 mt-1">Saved as it was shown. It does not change when sessions change later. An estimate to check against pay, not payroll.</p>
      </header>

      <section className="mb-6">
        <table>
          <thead>
            <tr>
              <th>Coach</th>
              <th className="num">Clients</th>
              <th className="num">Sessions</th>
              <th className="num">No-shows</th>
              <th className="num">Late cancels</th>
              <th className="num">Quiet 14+ days</th>
              <th className="num">Low on sessions</th>
              <th className="num">Rate per session</th>
              <th className="num">Estimate</th>
            </tr>
          </thead>
          <tbody>
            {s.rows.map((row) => (
              <tr key={row.coachId}>
                <td>{row.name}</td>
                <td className="num">{row.clients}</td>
                <td className="num">{row.sessionsDelivered}</td>
                <td className="num">{row.noShows}</td>
                <td className="num">{row.lateCancels}</td>
                <td className="num">{row.quietClients}</td>
                <td className="num">{row.lowBalanceClients}</td>
                <td className="num">{row.rateCents > 0 ? money(row.rateCents) : ""}</td>
                <td className="num">{money(row.estimateCents)}</td>
              </tr>
            ))}
            <tr>
              <td className="font-bold">Everyone</td>
              <td />
              <td className="num font-bold">{s.totals.sessionsDelivered}</td>
              <td colSpan={5} />
              <td className="num font-bold">{money(s.totals.estimateCents)}</td>
            </tr>
          </tbody>
        </table>
        <p className="text-xs text-gray-700 mt-1">Session credits sold in this period: {s.creditsSold}.</p>
      </section>

      <section>
        <h2 className="text-sm font-bold uppercase tracking-wide border-b border-gray-400 mb-2">The sessions behind the numbers ({s.sessionLines.length})</h2>
        {s.sessionLines.length === 0 ? (
          <p className="text-sm">No sessions were delivered in this period.</p>
        ) : (
          <table>
            <thead>
              <tr>
                <th>Coach</th>
                <th>Date</th>
                <th>Client</th>
                <th>Type</th>
                <th className="num">Estimate</th>
              </tr>
            </thead>
            <tbody>
              {s.sessionLines.map((l) => (
                <tr key={l.bookingId}>
                  <td>{l.coachName}</td>
                  <td>{dateKeyInZone(tz, new Date(l.startAt))}</td>
                  <td>{l.clientName}</td>
                  <td>{l.sessionType}</td>
                  <td className="num">{l.estimateCents > 0 ? money(l.estimateCents) : ""}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>
    </div>
  );
}
