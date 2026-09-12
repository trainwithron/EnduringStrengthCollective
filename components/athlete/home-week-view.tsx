import Link from "next/link";
import { Lock, Check } from "lucide-react";
import type { DayWorkoutInfo } from "@/lib/athlete-day-schedule";

const WEEKDAY_SHORT = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

export interface HomeDaySummary {
  dateKey: string;
  date: Date;
  workout: DayWorkoutInfo;
  macroCalories: number | null;
  habitsDue: number;
  habitsCompleted: number;
}

// One row per day of the week — same underlying per-day data the Day
// view itself uses, just at a glance instead of expanded. Tapping any
// row re-anchors Day view to that date; nothing here is directly
// actionable, matching [[athlete_home_calendar_redesign]]'s "Week/Month
// stay purely informational" rule.
export function HomeWeekView({
  groupId,
  days,
  todayKey,
  prevHref,
  nextHref,
  weekLabel,
}: {
  groupId: string;
  days: HomeDaySummary[];
  todayKey: string;
  prevHref: string;
  nextHref: string;
  weekLabel: string;
}) {
  return (
    <div>
      <div className="flex items-center justify-between mb-3">
        <Link href={prevHref} className="font-body text-xs text-rust uppercase tracking-wide">
          &larr; Prev
        </Link>
        <h2 className="font-display uppercase text-sm tracking-wide text-steel">{weekLabel}</h2>
        <Link href={nextHref} className="font-body text-xs text-rust uppercase tracking-wide">
          Next &rarr;
        </Link>
      </div>

      <div className="divide-y divide-steel/15 border-y border-steel/15">
        {days.map((day) => {
          const isToday = day.dateKey === todayKey;
          return (
            <Link
              key={day.dateKey}
              href={`/groups/${groupId}?view=day&date=${day.dateKey}`}
              className={`flex items-center gap-3 py-3 ${isToday ? "bg-surface/40" : ""}`}
            >
              <div className={`w-11 shrink-0 text-center ${isToday ? "text-rust" : "text-steel"}`}>
                <p className="font-body text-[10px] uppercase tracking-wide">
                  {WEEKDAY_SHORT[day.date.getDay()]}
                </p>
                <p className="font-display font-bold text-lg leading-none">{day.date.getDate()}</p>
              </div>
              <div className="flex-1 min-w-0">
                <p className="font-body text-sm font-medium flex items-center gap-1.5 truncate">
                  {day.workout.status === "locked" && <Lock className="w-3 h-3 shrink-0 text-steel" />}
                  {day.workout.status === "done" && <Check className="w-3 h-3 shrink-0 text-positive" />}
                  {day.workout.title ?? (day.workout.status === "rest" ? "Rest day" : "—")}
                </p>
                <p className="font-body text-[11px] text-steel mt-0.5">
                  {day.macroCalories != null ? `${day.macroCalories} kcal` : ""}
                  {day.macroCalories != null && day.habitsDue > 0 ? " · " : ""}
                  {day.habitsDue > 0 ? `${day.habitsCompleted}/${day.habitsDue} habits` : ""}
                </p>
              </div>
            </Link>
          );
        })}
      </div>
    </div>
  );
}
