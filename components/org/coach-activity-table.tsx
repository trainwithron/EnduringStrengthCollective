"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import type { CoachActivityRow } from "@/lib/coach-activity";
import { estimateCents, parseRateToCents } from "@/lib/coach-activity";
import { NOTE_MAX } from "@/lib/payroll-report";

const money = (cents: number) => (cents / 100).toLocaleString("en-US", { style: "currency", currency: "USD" });

// The per-coach table, the period, and the payroll ESTIMATE. The rate a coach is paid per session is typed here for the estimate and the spreadsheet; it is kept only in a saved
// pay period (Save this pay period, $3), and nothing is paid from here.
export function CoachActivityTable({ groupId, fromDay, toDay, timeZone, rows, creditsSold }: { groupId: string; fromDay: string; toDay: string; timeZone: string; rows: CoachActivityRow[]; creditsSold: number }) {
  const router = useRouter();
  const [from, setFrom] = useState(fromDay);
  const [to, setTo] = useState(toDay);
  const [rates, setRates] = useState<Record<string, string>>({});
  const [note, setNote] = useState("");
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [savedNote, setSavedNote] = useState<string | null>(null);

  const rateText = (coachId: string) => (rates[coachId] ?? "").trim();
  // A rate is dollars and cents ("45" or "45.50"); anything else is flagged and counts as nothing (never half-read).
  const rateCents = (coachId: string) => (rateText(coachId) === "" ? 0 : parseRateToCents(rateText(coachId)) ?? 0);
  const rateInvalid = (coachId: string) => rateText(coachId) !== "" && parseRateToCents(rateText(coachId)) === null;
  const csvHref = () => {
    const q = new URLSearchParams({ groupId, from, to });
    for (const r of rows) if (rateCents(r.coachId) > 0) q.set(`rate_${r.coachId}`, String(rateCents(r.coachId)));
    return `/api/coach/activity-csv?${q.toString()}`;
  };
  const anyRateInvalid = rows.some((r) => rateInvalid(r.coachId));

  async function savePeriod() {
    if (saving || anyRateInvalid) return;
    setSaving(true);
    setSaveError(null);
    setSavedNote(null);
    const ratesCents: Record<string, number> = {};
    for (const r of rows) if (rateCents(r.coachId) > 0) ratesCents[r.coachId] = rateCents(r.coachId);
    try {
      const res = await fetch("/api/coach/payroll-reports", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ groupId, from: fromDay, to: toDay, rates: ratesCents, note }),
      });
      const data = (await res.json().catch(() => ({}))) as { error?: string };
      if (!res.ok) throw new Error(data.error || "Couldn't save the pay period. Try again.");
      setNote("");
      setSavedNote("Saved. It is in Saved pay periods below.");
      router.refresh();
    } catch (err) {
      setSaveError(err instanceof Error ? err.message : "Couldn't save the pay period. Try again.");
    } finally {
      setSaving(false);
    }
  }
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
        <button type="submit" className="h-11 px-4 border border-rust text-rust-ink font-body text-sm font-medium">
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
                    aria-invalid={rateInvalid(r.coachId)}
                    className={`w-24 h-9 bg-graphite border text-chalk px-2 text-right font-body text-sm ${rateInvalid(r.coachId) ? "border-rust" : "border-steel/30"}`}
                  />
                  {rateInvalid(r.coachId) && <span className="block font-body text-xs text-rust-ink mt-1">Use dollars and cents, like 45 or 45.50.</span>}
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

      <p className="font-body text-xs text-steel mt-3">
        Days run midnight to midnight in {timeZone}. Session credits sold in this period: {creditsSold}.
      </p>
      <p className="font-body text-xs text-steel mt-1 max-w-[70ch]">
        The estimate is sessions delivered times the rate you type. It is an estimate to check against pay, not payroll: the rates are kept only when you save the pay period, and nothing is paid from here. The spreadsheet lists every session behind the numbers.
      </p>
      <a href={csvHref()} className="inline-flex items-center h-11 px-4 mt-4 border border-rust text-rust-ink font-body text-sm font-medium">
        Download the sessions (spreadsheet)
      </a>

      {/* Save this pay period ($3, Ron Nov 20): a frozen copy of what is shown above, with the rates typed, to reopen, print and download later. */}
      <div className="bg-surface rounded-card p-4 mt-6 max-w-[70ch]" data-save-pay-period>
        <p className="font-body text-sm font-semibold text-chalk">Save this pay period</p>
        <p className="font-body text-xs text-steel mt-1">
          Keeps {fromDay} to {toDay} exactly as shown, with the rates above. A saved period never changes, even if sessions change later. Only the owner and admins can see it.
        </p>
        <label className="block font-body text-xs text-steel mt-3">
          Note (optional)
          <textarea
            value={note}
            onChange={(e) => setNote(e.target.value)}
            maxLength={NOTE_MAX}
            rows={2}
            placeholder="For example: paid by check on the 16th"
            className="block w-full mt-1 bg-graphite border border-steel/30 text-chalk px-2.5 py-2 font-body text-sm"
          />
        </label>
        {anyRateInvalid && <p className="font-body text-xs text-rust-ink mt-2">Fix the rates above first.</p>}
        {saveError && (
          <p className="font-body text-xs text-rust-ink mt-2" role="alert">
            {saveError}
          </p>
        )}
        {savedNote && (
          <p className="font-body text-xs text-win mt-2" role="status">
            {savedNote}
          </p>
        )}
        <button
          type="button"
          onClick={savePeriod}
          disabled={saving || anyRateInvalid || from !== fromDay || to !== toDay}
          className="inline-flex items-center h-11 px-4 mt-3 rounded-token-pill bg-rust text-graphite font-body text-sm font-medium disabled:opacity-40"
        >
          {saving ? "Saving…" : "Save this pay period"}
        </button>
        {(from !== fromDay || to !== toDay) && <p className="font-body text-xs text-steel mt-2">Press Show first, so what you save is what you see.</p>}
      </div>
    </div>
  );
}
