import Link from "next/link";
import { Lock, Check } from "lucide-react";
import { TodayWidget, type TodayMacros, type TodayHabit } from "./today-widget";
import { WeightLogWidget, type WeightLogEntry } from "./weight-log-widget";
import type { DayWorkoutInfo } from "@/lib/athlete-day-schedule";

// One date's worth of Home content. `isToday` is the one flag that
// decides whether this renders live, write-capable controls (Start
// Workout, the actual weight-log form, editable habit checkboxes) or a
// plain browse-only summary — any other date, past or future, never
// gets an action control, only a read of what actually happened or
// what's planned. See [[athlete_home_calendar_redesign]] rule #1.
export function DayCard({
  groupId,
  athleteId,
  dateKey,
  dateLabel,
  isToday,
  workout,
  macros,
  habits,
  weightLogs,
  canBook,
}: {
  groupId: string;
  athleteId: string;
  dateKey: string;
  dateLabel: string;
  isToday: boolean;
  workout: DayWorkoutInfo;
  macros: TodayMacros | null;
  habits: TodayHabit[];
  weightLogs: WeightLogEntry[];
  canBook: boolean;
}) {
  return (
    <div className="space-y-4">
      <WorkoutSection
        groupId={groupId}
        dateKey={dateKey}
        dateLabel={dateLabel}
        isToday={isToday}
        workout={workout}
        canBook={canBook}
      />

      {isToday ? (
        <>
          <TodayWidget todayDate={dateKey} macros={macros} habits={habits} />
          <WeightLogWidget athleteId={athleteId} groupId={groupId} initialLogs={weightLogs} />
        </>
      ) : (
        <ReadOnlyDaySummary macros={macros} habits={habits} />
      )}
    </div>
  );
}

function WorkoutSection({
  groupId,
  dateKey,
  dateLabel,
  isToday,
  workout,
  canBook,
}: {
  groupId: string;
  dateKey: string;
  dateLabel: string;
  isToday: boolean;
  workout: DayWorkoutInfo;
  canBook: boolean;
}) {
  if (workout.status === "no-program") {
    return (
      <div className="border border-steel/20 p-4">
        <p className="font-body text-xs text-steel uppercase tracking-wide">{dateLabel}</p>
        <p className="font-body text-sm text-steel mt-2">
          No active program in this group yet, or you&apos;ve completed every workout in it — set
          one up from the Coach Dashboard.
        </p>
      </div>
    );
  }

  if (workout.status === "rest") {
    return (
      <div className="border border-steel/20 p-4">
        <p className="font-body text-xs text-steel uppercase tracking-wide">{dateLabel}</p>
        {canBook ? (
          <Link
            href={`/groups/${groupId}/calendar/${dateKey}`}
            className="font-body text-sm text-rust mt-2 inline-block"
          >
            Rest day — book a session with your coach &rarr;
          </Link>
        ) : (
          <p className="font-body text-sm text-steel mt-2">Rest day.</p>
        )}
      </div>
    );
  }

  const isPrimary = isToday && workout.status === "planned";

  return (
    <div className="border border-steel/20 p-4">
      <p className="font-body text-xs text-steel uppercase tracking-wide">{dateLabel}</p>
      <p className="font-display font-bold text-xl uppercase leading-none mt-1">{workout.title}</p>

      <div className="mt-3">
        {workout.status === "done" && (
          <Link
            href={`/groups/${groupId}/workouts/${workout.workoutId}`}
            className="font-body text-sm text-positive"
          >
            Completed — view workout
          </Link>
        )}
        {workout.status === "missed" && (
          <p className="font-body text-sm text-steel">Not logged.</p>
        )}
        {workout.status === "locked" && (
          <p className="font-body text-sm text-steel flex items-center gap-1.5">
            <Lock className="w-3.5 h-3.5" /> Unlocks {dateLabel}
          </p>
        )}
        {workout.status === "planned" && (
          <Link
            href={`/groups/${groupId}/workouts/${workout.workoutId}`}
            className={
              isPrimary
                ? "w-full h-11 flex items-center justify-center bg-rust text-graphite font-display uppercase text-sm font-bold"
                : "font-body text-sm text-rust"
            }
          >
            {isToday ? "Start workout" : "View planned workout"}
          </Link>
        )}
      </div>
    </div>
  );
}

function ReadOnlyDaySummary({
  macros,
  habits,
}: {
  macros: TodayMacros | null;
  habits: TodayHabit[];
}) {
  const hasMacros = macros && (macros.calories != null || macros.proteinG != null);
  if (!hasMacros && habits.length === 0) return null;

  return (
    <div className="border border-steel/20 p-4">
      {hasMacros && (
        <>
          <p className="font-body text-[10px] text-steel uppercase tracking-wide mb-1">Targets</p>
          <div className="grid grid-cols-4 gap-2 text-center mb-3">
            <div>
              <p className="font-display text-lg leading-none">{macros!.calories ?? "--"}</p>
              <p className="font-body text-[10px] text-steel uppercase mt-1">Kcal</p>
            </div>
            <div>
              <p className="font-display text-lg leading-none">{macros!.proteinG ?? "--"}</p>
              <p className="font-body text-[10px] text-steel uppercase mt-1">Protein</p>
            </div>
            <div>
              <p className="font-display text-lg leading-none">{macros!.carbsG ?? "--"}</p>
              <p className="font-body text-[10px] text-steel uppercase mt-1">Carbs</p>
            </div>
            <div>
              <p className="font-display text-lg leading-none">{macros!.fatG ?? "--"}</p>
              <p className="font-body text-[10px] text-steel uppercase mt-1">Fat</p>
            </div>
          </div>
        </>
      )}
      {habits.length > 0 && (
        <div className="space-y-1.5 pt-3 border-t border-steel/15">
          {habits.map((h) => (
            <div key={h.id} className="flex items-center gap-2">
              <span
                className={`w-5 h-5 shrink-0 border flex items-center justify-center ${
                  h.completed ? "bg-positive border-positive" : "border-steel/30"
                }`}
              >
                {h.completed && <Check className="w-3.5 h-3.5 text-graphite" strokeWidth={3} />}
              </span>
              <span className="font-body text-sm text-steel">{h.title}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
