"use client";

import Link from "next/link";
import { useState } from "react";
import { Check, ChevronRight, Dumbbell, StickyNote } from "lucide-react";
import { agoLabel, dayCardTitle, defaultWeek, exerciseCountLabel, previewLine, programStats, weekIsComplete, type PlainDay, type PlainWeek } from "@/lib/program-plain-view";

// The plain program view (FitPros is the reference): a stats card, a row of weeks, a card for each day of the chosen week, and a bottom sheet with the day's workout and its Start button.
// Read-only. The coach gets "Edit program" to reach the builder.
export function ProgramDayPicker({
  title,
  weeks,
  currentWeek,
  backHref,
  editHref,
  workoutHrefBase,
  canEdit,
  isCoachViewing,
  nowIso,
}: {
  title: string;
  weeks: PlainWeek[];
  currentWeek: number | null;
  backHref: string;
  editHref: string | null;
  workoutHrefBase: string;
  canEdit: boolean;
  isCoachViewing: boolean;
  nowIso: string;
}) {
  const [weekNumber, setWeekNumber] = useState(() => defaultWeek(weeks, currentWeek));
  const [open, setOpen] = useState<{ week: number; day: PlainDay } | null>(null);
  const week = weeks.find((w) => w.weekNumber === weekNumber);
  const stats = programStats(weeks);
  const now = new Date(nowIso);
  const circumference = 2 * Math.PI * 22;

  return (
    <main className="min-h-screen bg-graphite text-chalk font-body pb-28">
      <header className="px-5 pt-8 pb-3">
        <div className="flex items-center justify-between gap-3">
          <Link href={backHref} className="font-body text-sm text-rust min-h-11 inline-flex items-center">
            &larr; Back
          </Link>
          {canEdit && editHref && (
            <Link href={editHref} className="min-h-11 inline-flex items-center px-4 border border-rust text-rust font-body text-sm rounded-full">
              Edit program
            </Link>
          )}
        </div>
        <h1 className="font-display font-bold text-3xl leading-none mt-1 uppercase break-words">{title}</h1>
      </header>

      {weeks.length === 0 ? (
        <p className="px-5 pt-4 font-body text-sm text-steel">Nothing in this program yet.</p>
      ) : (
        <>
          <section className="mx-5 mt-2 rounded-2xl bg-surface/70 border border-steel/20 px-4 py-4 grid grid-cols-3 items-center text-center" aria-label="Program progress">
            <div>
              <p className="font-display font-bold text-3xl leading-none">{stats.weeks}</p>
              <p className="font-body text-xs text-steel mt-1">Weeks</p>
            </div>
            <div className="border-x border-steel/20">
              <p className="font-display font-bold text-3xl leading-none">{stats.workouts}</p>
              <p className="font-body text-xs text-steel mt-1">Workouts</p>
            </div>
            <div className="flex items-center justify-center gap-2">
              <svg width="56" height="56" viewBox="0 0 56 56" role="img" aria-label={`${stats.percent} percent complete`}>
                <circle cx="28" cy="28" r="22" fill="none" stroke="currentColor" strokeWidth="5" className="text-steel/30" />
                <circle
                  cx="28"
                  cy="28"
                  r="22"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="5"
                  strokeLinecap="round"
                  strokeDasharray={`${(stats.percent / 100) * circumference} ${circumference}`}
                  transform="rotate(-90 28 28)"
                  className="text-rust"
                />
                <text x="28" y="32" textAnchor="middle" fontSize="12" fontWeight="700" fill="currentColor" className="text-chalk">
                  {stats.percent}%
                </text>
              </svg>
              <div className="text-left">
                <p className="font-body text-sm leading-tight">
                  {stats.complete}/{stats.workouts}
                </p>
                <p className="font-body text-xs text-steel">Complete</p>
              </div>
            </div>
          </section>

          <nav className="mt-4 overflow-x-auto px-5" aria-label="Weeks">
            <div className="flex gap-2 w-max">
              {weeks.map((w) => {
                const on = w.weekNumber === weekNumber;
                return (
                  <button
                    key={w.weekNumber}
                    type="button"
                    aria-current={on ? "true" : undefined}
                    onClick={() => setWeekNumber(w.weekNumber)}
                    className={`shrink-0 min-h-11 px-4 rounded-full font-body text-sm whitespace-nowrap flex flex-col items-center justify-center ${on ? "bg-surface text-chalk border border-steel/40" : "text-steel"}`}
                  >
                    <span className="inline-flex items-center gap-1">
                      Week {w.weekNumber}
                      {weekIsComplete(w) && <Check className="w-4 h-4 text-positive" strokeWidth={3} aria-label="Week complete" />}
                    </span>
                    {currentWeek === w.weekNumber && <span className="font-body text-[10px] text-rust leading-none">This week</span>}
                  </button>
                );
              })}
            </div>
          </nav>

          <ul className="px-5 pt-3 space-y-3" aria-label={`Week ${weekNumber} days`}>
            {(week?.days ?? []).map((d) => {
              const done = d.completedAt != null;
              return (
                <li key={d.id}>
                  <button
                    type="button"
                    onClick={() => setOpen({ week: weekNumber, day: d })}
                    className="w-full flex items-center gap-3 rounded-2xl bg-surface/70 border border-steel/20 p-4 text-left active:bg-surface min-h-[88px]"
                  >
                    <span className={`shrink-0 w-12 h-12 rounded-full flex items-center justify-center ${done ? "bg-positive/20 text-positive" : "bg-rust/15 text-rust"}`} aria-hidden="true">
                      {done ? <Check className="w-6 h-6" strokeWidth={3} /> : <Dumbbell className="w-5 h-5" />}
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block font-body text-lg font-semibold leading-tight break-words">
                        {dayCardTitle(weekNumber, d)}
                        {d.isToday && <span className="ml-2 font-display text-xs uppercase tracking-wide text-rust align-middle">Today</span>}
                      </span>
                      <span className="block font-body text-sm text-steel truncate mt-0.5">{previewLine(d.exercises) || "Nothing in this day yet."}</span>
                      <span className="block font-body text-xs mt-1">
                        <span className="text-steel">{exerciseCountLabel(d.exercises.length)}</span>
                        {done && d.completedAt && <span className="text-positive"> {"·"} {agoLabel(d.completedAt, now)}</span>}
                      </span>
                    </span>
                    <ChevronRight className="w-5 h-5 text-steel shrink-0" aria-hidden="true" />
                  </button>
                </li>
              );
            })}
          </ul>
        </>
      )}

      {open && (
        <div className="fixed inset-0 z-50 flex flex-col justify-end" role="dialog" aria-modal="true" aria-label={dayCardTitle(open.week, open.day)}>
          <button type="button" className="absolute inset-0 bg-black/60" aria-label="Close" onClick={() => setOpen(null)} />
          <div className="relative bg-graphite border-t border-steel/30 rounded-t-3xl max-h-[88vh] flex flex-col">
            <div className="mx-auto mt-2 h-1.5 w-12 rounded-full bg-steel/40" aria-hidden="true" />
            <div className="px-5 pt-4 overflow-y-auto">
              <h2 className="font-display font-bold text-2xl leading-none">{dayCardTitle(open.week, open.day)}</h2>
              {open.day.dateLabel && <p className="font-body text-xs text-steel mt-1">{open.day.dateLabel}</p>}
              <div className="grid grid-cols-2 gap-3 mt-4">
                <div className="rounded-2xl bg-surface/70 border border-steel/20 py-3 text-center">
                  <p className="font-display font-bold text-2xl leading-none">{open.day.exercises.length}</p>
                  <p className="font-body text-[11px] text-steel uppercase tracking-wide mt-1">Exercises</p>
                </div>
                <div className="rounded-2xl bg-surface/70 border border-steel/20 py-3 text-center">
                  <p className="font-display font-bold text-2xl leading-none">{open.day.totalSets}</p>
                  <p className="font-body text-[11px] text-steel uppercase tracking-wide mt-1">Total sets</p>
                </div>
              </div>
              {open.day.exercises.length === 0 ? (
                <p className="font-body text-sm text-steel mt-5">Nothing in this day yet.</p>
              ) : (
                <ul className="mt-4 pb-4">
                  {open.day.exercises.map((e, i) => (
                    <li key={i} className="flex items-center gap-3 py-2.5">
                      {e.thumbUrl ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img src={e.thumbUrl} alt="" loading="lazy" decoding="async" className="w-14 h-14 rounded-full object-cover bg-surface shrink-0" />
                      ) : null}
                      <span className="min-w-0 flex-1">
                        <span className="block font-body text-base font-semibold break-words">{e.name}</span>
                        <span className="block font-body text-sm text-steel">{e.line}</span>
                      </span>
                      {e.note && (
                        <span className="shrink-0 w-9 h-9 rounded-full bg-surface flex items-center justify-center" title={e.note} aria-label="Has a coach note">
                          <StickyNote className="w-4 h-4 text-steel" aria-hidden="true" />
                        </span>
                      )}
                    </li>
                  ))}
                </ul>
              )}
            </div>
            <div className="px-5 py-3 border-t border-steel/20 pb-[max(0.75rem,env(safe-area-inset-bottom))]">
              {open.day.lockedLabel ? (
                <p className="font-body text-sm text-steel text-center">{open.day.lockedLabel}</p>
              ) : (
                <Link
                  href={`${workoutHrefBase}/${open.day.id}`}
                  className="flex items-center justify-center min-h-14 rounded-full bg-rust text-graphite font-display font-bold uppercase tracking-wide text-lg"
                >
                  {isCoachViewing ? "Open this workout" : "Start Workout"}
                </Link>
              )}
            </div>
          </div>
        </div>
      )}
    </main>
  );
}
