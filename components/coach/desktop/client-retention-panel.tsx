"use client";

import { useMemo, useState } from "react";
import { ACTIVE_DAYS, durationWords, PERIOD_LABEL, retentionSummary, type RetentionPeriod, type TenureRow } from "@/lib/client-retention";

// How long one-on-one clients stay (R4), on the Business page: the average time with you and how many are still active 3, 6 and 12 months after signing up. Read-only; the period says which
// sign-ups count. Dates only reach this page (no names), under the same privacy as the rest of the page.
export function ClientRetentionPanel({ rows, nowIso }: { rows: TenureRow[]; nowIso: string }) {
  const [period, setPeriod] = useState<RetentionPeriod>("all");
  const now = useMemo(() => new Date(nowIso), [nowIso]);
  const s = useMemo(() => retentionSummary(rows, now, period), [rows, now, period]);
  return (
    <div className="border border-steel/20 rounded-token-lg p-4" data-client-retention>
      <div className="flex flex-wrap items-baseline justify-between gap-2 mb-3">
        <h2 className="font-display uppercase text-sm tracking-wide text-steel">How long 1:1 clients stay</h2>
        <label className="font-body text-xs text-steel flex items-center gap-2">
          <span className="sr-only">Which clients</span>
          <select value={period} onChange={(e) => setPeriod(e.target.value as RetentionPeriod)} className="h-9 bg-surface border border-steel/30 px-2 font-body text-xs text-chalk">
            {(Object.keys(PERIOD_LABEL) as RetentionPeriod[]).map((p) => (
              <option key={p} value={p}>
                {PERIOD_LABEL[p]}
              </option>
            ))}
          </select>
        </label>
      </div>
      {s.clients === 0 ? (
        <p className="font-body text-sm text-steel">No one-on-one clients signed up in this period.</p>
      ) : (
        <>
          <p className="font-display text-3xl leading-none">{s.averageDays == null ? "-" : durationWords(s.averageDays)}</p>
          <p className="font-body text-xs text-steel mt-1">
            Average time with you, {s.clients} client{s.clients === 1 ? "" : "s"} ({s.stillActive} still active)
          </p>
          <ul className="mt-4 space-y-2.5">
            {s.after.map((a) => (
              <li key={a.months} className="font-body text-sm">
                <div className="flex items-baseline justify-between gap-3">
                  <span>Still active after {a.months} months</span>
                  <span className="tabular-nums text-chalk">{a.pct == null ? "Not yet" : `${a.stillActive} of ${a.signedUpLongEnough} (${a.pct}%)`}</span>
                </div>
                {a.pct != null && (
                  <div className="w-full h-2 bg-surface mt-1 overflow-hidden" aria-hidden>
                    <div className="h-2 bg-positive" style={{ width: `${a.pct}%` }} />
                  </div>
                )}
              </li>
            ))}
          </ul>
          <p className="font-body text-xs text-steel mt-3 max-w-[60ch]">
            Active means a workout or a session in the last {ACTIVE_DAYS} days. A client who stopped counts up to their last workout or session; one you removed counts up to then too.
          </p>
        </>
      )}
    </div>
  );
}
