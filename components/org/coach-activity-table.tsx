"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import type { CoachActivityRow } from "@/lib/coach-activity";
import { estimateCents } from "@/lib/coach-activity";

const money = (cents: number) => (cents / 100).toLocaleString("en-US", { style: "currency", currency: "USD" });

// The per-coach table, the period, and the payroll ESTIMATE. The rate a coach is paid per session is typed here for the estimate and for the spreadsheet only: it is not saved anywhere and nothing is paid from here.
export function CoachActivityTable({ groupId, fromDay, toDay, rows, creditsSold }: { groupId: string; fromDay: string; toDay: string; rows: CoachActivityRow[]; creditsSold: number }) {
  const router = useRouter();
  const [from, setFrom] = useState(fromDay);
  const [to, setTo] = useState(toDay);
  const [rates, setRates] = useState<Record<string, string>>({});

  const rateCents = (coachId: string) => {
    const n = parseFloat(rates[coachId] ?? "");
    return Number.isFinite(n) && n >= 0 ? Math.round(n * 100) : 0;
  };
  const csvHref = () => {
    const q = new URLSearchParams({ groupId, from, to });
    for (const r of rows) if (rateCents(r.coachId) > 0) q.set(`rate_${r.coachId}`, String(rateCents(r.coachId)));
    return `/api/coach/activity-csv?${q.toString()}`;
  };
  const totalDelivered = rows.reduce((n, r) => n + r.sessionsDelivered, 0);
  const totalEstimate = rows.reduce((n, r) => n + estimateCents(r.sessionsDelivered, rateCents(r.coachId)), 0);

  return (
    <div>
      <form
        className="flex flex-wrap items-end gap-3 mb-6"
        onSubmit={(e) => {
          e.preventDefault();
          router.push(`/groups/${groupId}/team-activity?from=${from}&to=${to}`);
        }}
      >
        <label className="font-body text-xs text-steel">
          From
          <input type="date" value={from} onChange={(e) => setFrom(e.target.value)} className="block h-11 mt-1 bg-graphite border border-steel/30 text-chalk px-2.5 font-body text-sm" />
        </label>
        <label className="font-body text-xs text-steel">
          To (included)
          <input type="date" value={to} onChange={(e) => setTo(e.target.value)} className="block h-11 mt-1 bg-graphite border border-steel/30 text-chalk px-2.5 font-body text-sm" />
        </label>
        <button type="submit" className="h-11 px-4 border border-rust text-rust font-body text-sm font-medium">
          Show
        </button>
      </form>

      <div className="overflow-x-auto border border-steel/20">
        <table className="w-full font-body text-sm">
          <thead>
            <tr className="text-left text-xs text-steel uppercase tracking-wide border-b border-steel/20">
              <th className="p-3">Coach</th>
              <th className="p-3 text-right">Clients</th>
              <th className="p-3 text-right">Sessions</th>
              <th className="p-3 text-right">No-shows</th>
              <th className="p-3 text-right">Late cancels</th>
              <th className="p-3 text-right">Quiet 14+ days</th>
              <th className="p-3 text-right">Low on sessions</th>
              <th className="p-3 text-right">Rate per session ($)</th>
              <th className="p-3 text-right">Estimate</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.coachId} className="border-b border-steel/10 last:border-b-0">
                <td className="p-3">{r.name}</td>
                <td className="p-3 text-right tabular-nums">{r.clients}</td>
                <td className="p-3 text-right tabular-nums">{r.sessionsDelivered}</td>
                <td className="p-3 text-right tabular-nums">{r.noShows}</td>
                <td className="p-3 text-right tabular-nums">{r.lateCancels}</td>
                <td className="p-3 text-right tabular-nums">{r.quietClients}</td>
                <td className="p-3 text-right tabular-nums">{r.lowBalanceClients}</td>
                <td className="p-3 text-right">
                  <input
                    aria-label={`Rate per session for ${r.name}`}
                    inputMode="decimal"
                    value={rates[r.coachId] ?? ""}
                    onChange={(e) => setRates((prev) => ({ ...prev, [r.coachId]: e.target.value }))}
                    placeholder="0.00"
                    className="w-24 h-9 bg-graphite border border-steel/30 text-chalk px-2 text-right font-body text-sm"
                  />
                </td>
                <td className="p-3 text-right tabular-nums">{money(estimateCents(r.sessionsDelivered, rateCents(r.coachId)))}</td>
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr className="border-t border-steel/20 text-steel">
              <td className="p-3">Everyone</td>
              <td className="p-3" colSpan={1} />
              <td className="p-3 text-right tabular-nums">{totalDelivered}</td>
              <td className="p-3" colSpan={5} />
              <td className="p-3 text-right tabular-nums">{money(totalEstimate)}</td>
            </tr>
          </tfoot>
        </table>
      </div>

      <p className="font-body text-xs text-steel mt-3">Session credits sold in this period: {creditsSold}.</p>
      <p className="font-body text-xs text-steel mt-1 max-w-[70ch]">
        The estimate is sessions delivered times the rate you type. It is an estimate to check against pay, not payroll: the rates are not saved and nothing is paid from here. The spreadsheet lists every session behind the numbers.
      </p>
      <a href={csvHref()} className="inline-flex items-center h-11 px-4 mt-4 border border-rust text-rust font-body text-sm font-medium">
        Download the sessions (spreadsheet)
      </a>
    </div>
  );
}
