import Link from "next/link";
import { Lock, Check } from "lucide-react";

export interface WeekDayEntry {
  workoutId: string;
  title: string;
  date: string; // "YYYY-MM-DD"
  weekday: string; // "Mon", "Wed", ...
  status: "done" | "open" | "locked";
  isToday: boolean;
}

// Home-screen quick access to this week's training days — the athlete
// doesn't have to open the calendar or the full program list just to
// start (or revisit) a workout from earlier in the week. A locked day
// still shows (builds the same trust-through-transparency the coach
// wanted — you can see the week's shape even before it's due) but isn't
// a link; nothing about opening this view changes what's actually
// completable, that's already governed by the program's own visibility
// window.
export function WeekAtAGlance({ groupId, days }: { groupId: string; days: WeekDayEntry[] }) {
  if (days.length === 0) return null;

  return (
    <section>
      <h2 className="font-display uppercase text-sm tracking-wide text-steel mb-2">
        This Week
      </h2>
      <div className="grid grid-cols-7 gap-1.5">
        {days.map((day) => {
          const content = (
            <div
              className={`h-16 flex flex-col items-center justify-center gap-1 border font-body transition-colors ${
                day.status === "done"
                  ? "border-positive/40 bg-positive/10 text-positive"
                  : day.status === "locked"
                    ? "border-steel/20 text-steel/60"
                    : "border-rust bg-rust/10 text-rust active:bg-rust/20"
              } ${day.isToday ? "ring-1 ring-rust ring-offset-1 ring-offset-graphite" : ""}`}
            >
              <span className="text-[10px] uppercase tracking-wide">{day.weekday}</span>
              {day.status === "done" ? (
                <Check className="w-4 h-4" strokeWidth={2.5} />
              ) : day.status === "locked" ? (
                <Lock className="w-3.5 h-3.5" />
              ) : (
                <span className="text-[10px] font-medium truncate max-w-[90%]">Start</span>
              )}
            </div>
          );

          return day.status === "locked" ? (
            <div key={day.workoutId} title={`Unlocks ${day.date}`}>
              {content}
            </div>
          ) : (
            <Link key={day.workoutId} href={`/groups/${groupId}/workouts/${day.workoutId}`} title={day.title}>
              {content}
            </Link>
          );
        })}
      </div>
    </section>
  );
}
