"use client";

import { useMemo, useState } from "react";
import {
  defaultChoice,
  lifetimeStats,
  monthOptions,
  periodStats,
  yearOptions,
  type PeriodChoice,
  type PeriodKind,
  type StatEvent,
  type Stats,
} from "@/lib/progress-periods";

const PERIODS: { kind: PeriodKind; label: string }[] = [
  { kind: "weekly", label: "Weekly" },
  { kind: "monthly", label: "Monthly" },
  { kind: "yearly", label: "Yearly" },
];

function Numbers({ stats }: { stats: Stats }) {
  return (
    <div className="flex gap-6">
      <div>
        <p className="font-display text-2xl">{stats.workouts}</p>
        <p className="font-body text-xs text-steel">Workouts</p>
      </div>
      <div>
        <p className="font-display text-2xl">{Math.round(stats.volume).toLocaleString()}</p>
        <p className="font-body text-xs text-steel">Volume (lbs)</p>
      </div>
      <div>
        <p className="font-display text-2xl">{stats.prs}</p>
        <p className="font-body text-xs text-steel">PRs</p>
      </div>
    </div>
  );
}

const selectClass = "h-11 bg-graphite border border-steel/30 text-chalk px-2 font-body text-xs";

// Two groups of the same three numbers: the lifetime ones, and the ones for a period the coach picks on the word itself (Weekly is this calendar week; Monthly and Yearly pick which).
export function ProgressStats({ events, prDates, todayKey }: { events: StatEvent[]; prDates: string[]; todayKey: string }) {
  const [choice, setChoice] = useState<PeriodChoice>(() => defaultChoice(todayKey));
  const allDates = useMemo(() => [...events.map((e) => e.date), ...prDates], [events, prDates]);
  const months = useMemo(() => monthOptions(allDates, todayKey), [allDates, todayKey]);
  const years = useMemo(() => yearOptions(allDates, todayKey), [allDates, todayKey]);
  const lifetime = useMemo(() => lifetimeStats(events, prDates), [events, prDates]);
  const period = useMemo(() => periodStats(events, prDates, choice, todayKey), [events, prDates, choice, todayKey]);

  return (
    <div className="flex flex-wrap gap-x-10 gap-y-4 pb-4 border-b border-steel/15">
      <div>
        <p className="font-body text-xs text-steel uppercase tracking-wide mb-1 min-h-11 flex items-center">Lifetime stats</p>
        <Numbers stats={lifetime} />
      </div>
      <div className="sm:border-l sm:border-steel/20 sm:pl-10">
        <div className="flex flex-wrap items-center gap-2 mb-1">
          <label className="sr-only" htmlFor="progress-period">
            Period
          </label>
          <select
            id="progress-period"
            value={choice.kind}
            onChange={(e) => setChoice({ ...choice, kind: e.target.value as PeriodKind })}
            className={`${selectClass} uppercase tracking-wide`}
          >
            {PERIODS.map((p) => (
              <option key={p.kind} value={p.kind}>
                {p.label}
              </option>
            ))}
          </select>
          {choice.kind === "monthly" && (
            <>
              <label className="sr-only" htmlFor="progress-month">
                Month
              </label>
              <select id="progress-month" value={choice.month} onChange={(e) => setChoice({ ...choice, month: e.target.value })} className={selectClass}>
                {months.map((m) => (
                  <option key={m.key} value={m.key}>
                    {m.label}
                  </option>
                ))}
              </select>
            </>
          )}
          {choice.kind === "yearly" && (
            <>
              <label className="sr-only" htmlFor="progress-year">
                Year
              </label>
              <select id="progress-year" value={choice.year} onChange={(e) => setChoice({ ...choice, year: e.target.value })} className={selectClass}>
                {years.map((y) => (
                  <option key={y} value={y}>
                    {y}
                  </option>
                ))}
              </select>
            </>
          )}
        </div>
        <Numbers stats={period} />
      </div>
    </div>
  );
}
