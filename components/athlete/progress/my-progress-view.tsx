"use client";

import Link from "next/link";
import { useState } from "react";
import type { MyProgressCard } from "@/lib/my-progress";
import { changeOver, type E1rmPoint } from "@/lib/progress-lines";
import type { SeriesPoint } from "@/lib/progress-cards";
import { liftDisplayValue, liftUnitLabel } from "@/lib/lift-weight";
import type { WeightUnit } from "@/lib/units";
import { ProgressLineChart } from "@/components/athlete/progress/progress-line-chart";

// The My progress screen (wave 2, P1 + P2; Ron approved the mockup Nov 20): a row of lift chips (and Body weight), the chosen one's line with its latest number
// and how it moved over the last 12 weeks, the best at each rep count for a lift, then Photos and Measurements, and the year's recap in December.

// The rep counts the table shows (the ones lifters ask about); a count with no set at or above it is left out.
const TABLE_REPS = [1, 3, 5, 8, 10];
// A best set this recent is marked "new".
const NEW_DAYS = 14;
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

const shortDate = (key: string) => `${MONTHS[Number(key.slice(5, 7)) - 1]} ${Number(key.slice(8, 10))}`;
const dayNum = (key: string) => Date.parse(`${key.slice(0, 10)}T12:00:00Z`) / 86400000;

function shown(lbs: number, unit: WeightUnit): string {
  const v = liftDisplayValue(lbs, unit);
  return Number.isInteger(v) ? String(v) : v.toFixed(1);
}

function changeText(delta: number, since: string, fullWindow: boolean, unitLabel: string): string {
  const sign = delta > 0 ? "+" : delta < 0 ? "−" : "";
  const amount = `${sign}${Math.abs(delta) % 1 === 0 ? Math.abs(delta) : Math.abs(delta).toFixed(1)} ${unitLabel}`;
  return fullWindow ? `${amount} in 12 weeks` : `${amount} since ${shortDate(since)}`;
}

export function MyProgressView({
  groupId,
  firstName,
  cards,
  bodyWeight,
  todayKey,
  unit,
  incomplete,
  recapYear,
}: {
  groupId: string;
  firstName: string;
  cards: MyProgressCard[];
  bodyWeight: SeriesPoint[];
  todayKey: string;
  unit: WeightUnit;
  incomplete: boolean;
  recapYear: number | null;
}) {
  const BODY = "__body__";
  const [chosen, setChosen] = useState<string>(cards[0]?.name ?? (bodyWeight.length > 0 ? BODY : ""));
  const card = cards.find((c) => c.name === chosen) ?? null;
  const unitLabel = liftUnitLabel(unit);
  // a lift with no estimate (only high-rep sets) shows its heaviest set instead
  const series: SeriesPoint[] = chosen === BODY ? bodyWeight : card ? (card.e1rmSeries.length > 0 ? card.e1rmSeries : card.weightSeries) : [];
  // The card's number is the LATEST estimate (its last point); the line under the table is the BEST one (live finding, Nov 20: two "estimated max" numbers read as a contradiction).
  const measure = chosen === BODY ? "Body weight" : card && card.e1rmSeries.length > 0 ? "Latest estimated max" : "Heaviest set";
  // the set the latest estimate came from, when the line was built from the lift's own sets
  const lastPoint = chosen !== BODY && card && card.e1rmSeries.length > 0 ? card.e1rmSeries[card.e1rmSeries.length - 1] : null;
  const fromSet = lastPoint && "weight" in lastPoint ? (lastPoint as E1rmPoint) : null;
  const inUnit = series.map((p) => ({ date: p.date, value: liftDisplayValue(p.value, unit) }));
  const latest = inUnit[inUnit.length - 1] ?? null;
  const moved = changeOver(inUnit, todayKey);
  // body weight going down is not judged good or bad; a lift going up is a win
  const movedClass = moved && chosen !== BODY && moved.delta > 0 ? "text-win" : "text-steel";
  const table = chosen === BODY ? null : card?.repMaxes ?? null;
  const tableRows = table ? TABLE_REPS.map((n) => table.rows.find((r) => r.reps === n)).filter((r): r is NonNullable<typeof r> => !!r) : [];

  return (
    <div className="px-5 pt-5 flex flex-col gap-4">
      <div>
        {firstName && <p className="font-body text-[13px] text-steel">{firstName}</p>}
        <h1 className="font-display font-semibold text-3xl leading-tight">My progress</h1>
      </div>

      {incomplete && (
        <p className="font-body text-sm text-chalk tint-alert rounded-row px-3 py-2" role="status">
          Some of your history could not be read just now. What shows here may be missing a few workouts.
        </p>
      )}

      {cards.length === 0 && bodyWeight.length === 0 ? (
        <section className="bg-surface rounded-card p-4">
          <p className="font-body text-sm text-chalk">Your lifts show up here once you log a few workouts.</p>
        </section>
      ) : (
        <>
          <div className="-mx-5 px-5 overflow-x-auto scroll-hidden" role="group" aria-label="Lifts">
            <div className="flex gap-1.5 w-max">
              {[...cards.map((c) => ({ key: c.name, label: c.name })), ...(bodyWeight.length > 0 ? [{ key: BODY, label: "Body weight" }] : [])].map((chip) => {
                const on = chip.key === chosen;
                return (
                  <button
                    key={chip.key}
                    type="button"
                    aria-pressed={on}
                    onClick={() => setChosen(chip.key)}
                    className={`shrink-0 min-h-11 px-4 rounded-token-pill font-body text-[13px] whitespace-nowrap ${on ? "bg-rust/15 text-rust-ink font-semibold" : "bg-surface text-steel"}`}
                  >
                    {chip.label}
                  </button>
                );
              })}
            </div>
          </div>

          <section className="bg-surface rounded-card p-4 flex flex-col gap-2" aria-label={chosen === BODY ? "Body weight" : chosen}>
            <div className="flex items-baseline justify-between gap-3">
              <span className="font-body text-[13px] text-steel">{measure}</span>
              {moved && <span className={`font-body text-[13px] font-semibold ${movedClass}`}>{changeText(moved.delta, moved.since, moved.fullWindow, unitLabel)}</span>}
            </div>
            {latest && (
              <p className="font-display font-medium text-4xl leading-none tabular-nums">
                {shown(series[series.length - 1].value, unit)} {unitLabel}
              </p>
            )}
            {fromSet && (
              <p className="font-body text-xs text-steel" data-latest-from>
                From your best set that day: {shown(fromSet.weight, unit)} × {fromSet.reps} on {shortDate(fromSet.date)}
              </p>
            )}
            <ProgressLineChart
              points={inUnit}
              label={latest && inUnit.length > 1 ? `${measure}, from ${inUnit[0].value} to ${latest.value} ${unitLabel}` : measure}
              emptyLabel={chosen === BODY ? "Two or more weigh-ins draw the line." : "Two or more workouts with this lift draw the line."}
            />
          </section>

          {tableRows.length > 0 && (
            <section className="bg-surface rounded-card p-4" aria-labelledby="rep-best-heading">
              <h2 id="rep-best-heading" className="font-body text-[15px] font-semibold mb-2">
                Best at each rep count
              </h2>
              <table className="w-full font-body text-sm tabular-nums">
                <thead>
                  <tr className="text-left text-xs text-steel">
                    <th scope="col" className="font-normal pb-1 w-16">Reps</th>
                    <th scope="col" className="font-normal pb-1">Best</th>
                    <th scope="col" className="font-normal pb-1 text-right">Date</th>
                  </tr>
                </thead>
                <tbody>
                  {tableRows.map((r) => {
                    const fresh = dayNum(todayKey) - dayNum(r.at) <= NEW_DAYS;
                    return (
                      <tr key={r.reps} className="border-t border-steel/20">
                        <td className="py-2 text-steel">{r.reps}</td>
                        <td className={`py-2 font-semibold ${fresh ? "text-rust-ink" : ""}`}>
                          {shown(r.weight, unit)} {unitLabel}
                          {r.fromReps > r.reps && <span className="font-normal text-steel"> (× {r.fromReps})</span>}
                          {fresh && <span className="font-normal"> · new</span>}
                        </td>
                        <td className="py-2 text-right text-steel">{shortDate(r.at)}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
              {table?.estimatedMax && (
                <p className="font-body text-xs text-steel mt-2">
                  Best estimated max {shown(table.estimatedMax.value, unit)} {unitLabel}, from {shown(table.estimatedMax.weight, unit)} × {table.estimatedMax.reps} on {shortDate(table.estimatedMax.at)}.
                </p>
              )}
            </section>
          )}
        </>
      )}

      <div className="grid grid-cols-2 gap-2.5">
        <Link href={`/groups/${groupId}/progress/photos`} className="bg-surface rounded-card p-3.5 min-h-11 active:bg-surface-2">
          <span className="block font-body text-sm font-semibold">Photos</span>
          <span className="block font-body text-xs text-steel">Compare two dates</span>
        </Link>
        <Link href={`/groups/${groupId}/progress/measurements`} className="bg-surface rounded-card p-3.5 min-h-11 active:bg-surface-2">
          <span className="block font-body text-sm font-semibold">Measurements</span>
          <span className="block font-body text-xs text-steel">Waist, hips, arms…</span>
        </Link>
      </div>

      {recapYear != null && (
        <Link href={`/groups/${groupId}/progress/recap`} className="tint-accent rounded-card p-3.5 min-h-11 block">
          <span className="block font-body text-sm font-semibold text-rust-ink">Your {recapYear} recap</span>
          <span className="block font-body text-xs text-steel">Your year in a few pictures, yours to share</span>
        </Link>
      )}
    </div>
  );
}
