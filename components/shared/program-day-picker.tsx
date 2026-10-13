"use client";

import Link from "next/link";
import { useState } from "react";
import { dayChipLabel, defaultDay, defaultWeek, type PlainWeek } from "@/lib/program-plain-view";

// The plain program view: a week row, a day row, and that day's workout with its Log / Open button. Read-only. The coach gets "Edit program" to reach the builder.
export function ProgramDayPicker({
  title,
  weeks,
  currentWeek,
  backHref,
  editHref,
  workoutHrefBase,
  canEdit,
  isCoachViewing,
}: {
  title: string;
  weeks: PlainWeek[];
  currentWeek: number | null;
  backHref: string;
  editHref: string | null;
  workoutHrefBase: string;
  canEdit: boolean;
  isCoachViewing: boolean;
}) {
  const [weekNumber, setWeekNumber] = useState(() => defaultWeek(weeks, currentWeek));
  const week = weeks.find((w) => w.weekNumber === weekNumber);
  const [dayId, setDayId] = useState<string | null>(() => defaultDay(weeks.find((w) => w.weekNumber === defaultWeek(weeks, currentWeek))));
  const day = week?.days.find((d) => d.id === dayId) ?? week?.days[0] ?? null;

  function pickWeek(n: number) {
    setWeekNumber(n);
    setDayId(defaultDay(weeks.find((w) => w.weekNumber === n)));
  }

  const chip = (on: boolean) =>
    `shrink-0 min-h-11 px-4 border font-body text-sm whitespace-nowrap ${on ? "bg-rust text-graphite border-rust" : "text-chalk border-steel/40"}`;

  return (
    <main className="min-h-screen bg-graphite text-chalk font-body pb-24">
      <header className="px-5 pt-8 pb-4 border-b border-steel/20">
        <div className="flex items-center justify-between gap-3">
          <Link href={backHref} className="font-body text-xs text-steel uppercase tracking-wide min-h-11 inline-flex items-center">
            &larr; Back
          </Link>
          {canEdit && editHref && (
            <Link href={editHref} className="min-h-11 inline-flex items-center px-4 border border-rust text-rust font-body text-sm">
              Edit program
            </Link>
          )}
        </div>
        <h1 className="font-display font-bold text-3xl leading-none mt-1 uppercase break-words">{title}</h1>
      </header>

      {weeks.length === 0 ? (
        <p className="px-5 pt-6 font-body text-sm text-steel">Nothing in this program yet.</p>
      ) : (
        <>
          <div className="px-5 pt-4 overflow-x-auto" role="tablist" aria-label="Weeks">
            <div className="flex gap-2 w-max">
              {weeks.map((w) => (
                <div key={w.weekNumber} className="flex flex-col items-center">
                  <button type="button" role="tab" aria-selected={w.weekNumber === weekNumber} onClick={() => pickWeek(w.weekNumber)} className={chip(w.weekNumber === weekNumber)}>
                    Week {w.weekNumber}
                  </button>
                  {currentWeek === w.weekNumber && <span className="font-body text-[11px] text-steel mt-0.5">This week</span>}
                </div>
              ))}
            </div>
          </div>

          <div className="px-5 pt-3 overflow-x-auto" role="tablist" aria-label="Days">
            <div className="flex gap-2 w-max">
              {(week?.days ?? []).map((d) => (
                <div key={d.id} className="flex flex-col items-center">
                  <button type="button" role="tab" aria-selected={day?.id === d.id} onClick={() => setDayId(d.id)} className={chip(day?.id === d.id)}>
                    {dayChipLabel(d)}
                  </button>
                  {d.isToday && <span className="font-body text-[11px] text-rust mt-0.5">Today</span>}
                </div>
              ))}
            </div>
          </div>

          <section className="px-5 pt-5" aria-live="polite">
            {!day || day.exercises.length === 0 ? (
              <p className="font-body text-sm text-steel">Nothing in this day yet.</p>
            ) : (
              <>
                {day.dateLabel && <p className="font-body text-xs text-steel mb-2">{day.dateLabel}</p>}
                <ul className="divide-y divide-steel/15 border-y border-steel/15">
                  {day.exercises.map((e, i) => (
                    <li key={i} className="py-3">
                      <div className="flex items-baseline justify-between gap-3">
                        <span className="font-body text-[15px] break-words min-w-0">{e.name}</span>
                        <span className="font-body text-sm text-steel shrink-0 [font-variant-numeric:tabular-nums]">{e.line}</span>
                      </div>
                      {e.note && <p className="font-body text-xs text-steel mt-1 break-words">{e.note}</p>}
                    </li>
                  ))}
                </ul>
                {day.lockedLabel ? (
                  <p className="font-body text-sm text-steel mt-4">{day.lockedLabel}</p>
                ) : (
                  <Link href={`${workoutHrefBase}/${day.id}`} className="mt-4 inline-flex items-center justify-center min-h-11 px-6 bg-rust text-graphite font-display font-bold uppercase tracking-wide">
                    {isCoachViewing ? "Open this workout" : "Log this workout"}
                  </Link>
                )}
              </>
            )}
          </section>
        </>
      )}
    </main>
  );
}
