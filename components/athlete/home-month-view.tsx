import Link from "next/link";
import { Lock, Check } from "lucide-react";
import type { HomeDaySummary } from "./home-week-view";

const WEEKDAY_LABELS = ["Su", "Mo", "Tu", "We", "Th", "Fr", "Sa"];

// Same month-grid shape/density as the coach's existing per-program
// calendar (app/groups/[groupId]/programs/[programId]/calendar/page.tsx)
// — reused here at the Home level instead of reinvented, per the build
// spec. Tapping a day re-anchors Day view to that date.
export function HomeMonthView({
  groupId,
  year,
  monthIndex,
  monthLabel,
  summaryByDateKey,
  todayKey,
  prevHref,
  nextHref,
}: {
  groupId: string;
  year: number;
  monthIndex: number;
  monthLabel: string;
  summaryByDateKey: Map<string, HomeDaySummary>;
  todayKey: string;
  prevHref: string;
  nextHref: string;
}) {
  const firstOfMonth = new Date(year, monthIndex, 1);
  const daysInMonth = new Date(year, monthIndex + 1, 0).getDate();
  const leadingBlanks = firstOfMonth.getDay();
  const cells: (Date | null)[] = [
    ...Array.from({ length: leadingBlanks }, () => null),
    ...Array.from({ length: daysInMonth }, (_, i) => new Date(year, monthIndex, i + 1)),
  ];

  function dateKey(d: Date): string {
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  }

  return (
    <div>
      <div className="flex items-center justify-between mb-3">
        <Link href={prevHref} className="inline-flex items-center min-h-11 font-body text-xs text-rust uppercase tracking-wide">
          &larr; Prev
        </Link>
        <h2 className="font-display uppercase text-sm tracking-wide text-steel">{monthLabel}</h2>
        <Link href={nextHref} className="inline-flex items-center min-h-11 font-body text-xs text-rust uppercase tracking-wide">
          Next &rarr;
        </Link>
      </div>

      <div className="grid grid-cols-7 gap-px bg-steel/15 border border-steel/15">
        {WEEKDAY_LABELS.map((label) => (
          <div
            key={label}
            className="bg-graphite text-center font-body text-xs text-steel uppercase tracking-wide py-1.5"
          >
            {label}
          </div>
        ))}

        {cells.map((date, i) => {
          if (!date) return <div key={i} className="bg-graphite min-h-[64px]" />;
          const key = dateKey(date);
          const isToday = key === todayKey;
          const summary = summaryByDateKey.get(key);
          const cellClass = `bg-graphite min-h-[64px] p-1.5 flex flex-col ${
            isToday ? "ring-1 ring-inset ring-rust" : ""
          }`;

          return (
            <Link key={i} href={`/groups/${groupId}?view=day&date=${key}`} className={cellClass}>
              <span className={`font-body text-xs ${isToday ? "text-rust font-bold" : "text-steel"}`}>
                {date.getDate()}
              </span>
              {/* A 45px-wide cell has no room for a title or numbers: one mark says what the day is, and tapping it opens the day's full card. */}
              {summary?.workout.status === "done" && (
                <span className="mt-1 flex items-center gap-0.5 text-positive" aria-label="Done">
                  <Check className="w-3.5 h-3.5 shrink-0" strokeWidth={3} />
                  {(summary.sessionCount ?? 0) > 1 && <span className="font-body text-xs">+{(summary.sessionCount ?? 0) - 1}</span>}
                </span>
              )}
              {summary?.workout.status === "locked" && (
                <span className="mt-1 flex items-center text-steel" aria-label="Locked">
                  <Lock className="w-3 h-3 shrink-0" />
                </span>
              )}
              {summary?.workout.status === "planned" && (
                <span className="mt-1 flex items-center gap-0.5 text-chalk" aria-label="Planned">
                  <span className="w-2 h-2 rounded-full bg-chalk shrink-0" />
                  {(summary.sessionCount ?? 0) > 1 && <span className="font-body text-xs text-steel">+{(summary.sessionCount ?? 0) - 1}</span>}
                </span>
              )}
              {summary?.workout.status === "missed" && (
                <span className="mt-1 flex items-center text-steel" aria-label="Not logged">
                  <span className="w-2 h-2 rounded-full border border-steel shrink-0" />
                </span>
              )}
            </Link>
          );
        })}
      </div>
    </div>
  );
}
