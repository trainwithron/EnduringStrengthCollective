import Link from "next/link";
import { Lock } from "lucide-react";
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
        <Link href={prevHref} className="font-body text-xs text-rust uppercase tracking-wide">
          &larr; Prev
        </Link>
        <h2 className="font-display uppercase text-sm tracking-wide text-steel">{monthLabel}</h2>
        <Link href={nextHref} className="font-body text-xs text-rust uppercase tracking-wide">
          Next &rarr;
        </Link>
      </div>

      <div className="grid grid-cols-7 gap-px bg-steel/15 border border-steel/15">
        {WEEKDAY_LABELS.map((label) => (
          <div
            key={label}
            className="bg-graphite text-center font-body text-[10px] text-steel uppercase tracking-wide py-1.5"
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
              <span className={`font-body text-[10px] ${isToday ? "text-rust font-bold" : "text-steel"}`}>
                {date.getDate()}
              </span>
              {summary?.workout.title && (
                <span
                  className={`font-body text-[9px] leading-tight mt-0.5 truncate flex items-center gap-0.5 ${
                    summary.workout.status === "locked" ? "text-steel" : "text-chalk"
                  }`}
                >
                  {summary.workout.status === "locked" && <Lock className="w-2 h-2 shrink-0" />}
                  {summary.workout.title}
                </span>
              )}
              {summary?.workout.status === "done" && (
                <span className="font-body text-[9px] text-positive mt-0.5">Done</span>
              )}
              {summary && (summary.macroCalories != null || summary.habitsDue > 0) && (
                <span className="font-body text-[8px] text-steel mt-0.5 truncate">
                  {summary.macroCalories != null ? `${summary.macroCalories}cal` : ""}
                  {summary.macroCalories != null && summary.habitsDue > 0 ? " " : ""}
                  {summary.habitsDue > 0 ? `${summary.habitsCompleted}/${summary.habitsDue}h` : ""}
                </span>
              )}
            </Link>
          );
        })}
      </div>
    </div>
  );
}
