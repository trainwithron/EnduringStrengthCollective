import Link from "next/link";
import { sessionBalanceLine } from "@/lib/session-credit-copy";
import { Lock, Check } from "lucide-react";
import { TodayWidget, type TodayMacros, type TodayHabit } from "./today-widget";
import { WeightLogWidget, type WeightLogEntry } from "./weight-log-widget";
import type { DayWorkoutInfo } from "@/lib/athlete-day-schedule";
import type { DaySession } from "@/lib/program-day-contexts";
import { computeReadinessAverage, type WellnessCheckinValues } from "@/lib/wellness";

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
  sessions = [],
  macros,
  habits,
  weightLogs,
  canBook,
  wellnessCheckin,
  nextLabel = null,
  mealLine = null,
  sessionsLeft = null,
}: {
  groupId: string;
  athleteId: string;
  dateKey: string;
  dateLabel: string;
  isToday: boolean;
  // The fallback for a day with nothing in any program (rest day, no program, etc.).
  workout: DayWorkoutInfo;
  // One entry per active program that has something on this day, in the coach's order.
  sessions?: DaySession[];
  macros: TodayMacros | null;
  habits: TodayHabit[];
  weightLogs: WeightLogEntry[];
  canBook: boolean;
  wellnessCheckin?: WellnessCheckinValues | null;
  // "Tomorrow" or a weekday: the next workout, shown on the condensed done card.
  nextLabel?: string | null;
  // "Meals logged: 2 of 4", when there is a meal plan today.
  mealLine?: string | null;
  // The client's sessions left, shown beside "Book a session" when they have any.
  sessionsLeft?: number | null;
}) {
  return (
    <div className="space-y-4">
      <WorkoutSection
        groupId={groupId}
        dateKey={dateKey}
        dateLabel={dateLabel}
        isToday={isToday}
        workout={workout}
        sessions={sessions}
        canBook={canBook}
        sessionsLeft={sessionsLeft}
        wellnessCheckin={isToday ? wellnessCheckin ?? null : null}
        nextLabel={nextLabel}
      />

      {isToday ? (
        <>
          <TodayWidget todayDate={dateKey} macros={macros} habits={habits} mealLine={mealLine ?? null} mealHref={`/groups/${groupId}/nutrition`} />
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
  sessions,
  canBook,
  sessionsLeft,
  wellnessCheckin,
  nextLabel,
}: {
  groupId: string;
  dateKey: string;
  dateLabel: string;
  isToday: boolean;
  workout: DayWorkoutInfo;
  sessions: DaySession[];
  canBook: boolean;
  sessionsLeft?: number | null;
  wellnessCheckin?: WellnessCheckinValues | null;
  nextLabel?: string | null;
}) {
  const readinessChip = wellnessCheckin ? (
    <span className="font-body text-xs text-steel border border-steel/30 px-2 py-0.5 ml-2">
      Feeling {Math.round(computeReadinessAverage(wellnessCheckin))}/5 today
    </span>
  ) : null;

  // Everything for today is finished: one big check in a small card, so the day reads as done and the rest of Home
  // (nutrition, calendar) is right below it. Nobody does the same workout twice in a day.
  const finished = sessions.length > 0 ? sessions : workout.workoutId ? [workout] : [];
  if (isToday && finished.length > 0 && finished.every((x) => x.status === "done")) {
    const titles = finished.map((x) => x.title).filter(Boolean).join(" + ");
    return (
      <div className="border border-positive/40 p-4 flex items-center gap-3">
        <span className="w-11 h-11 shrink-0 rounded-full bg-positive/15 flex items-center justify-center">
          <Check className="w-6 h-6 text-positive" strokeWidth={3} />
        </span>
        <div className="min-w-0 flex-1">
          <p className="font-display font-bold text-xl uppercase leading-none">Done for today</p>
          <p className="font-body text-xs text-steel mt-1 truncate">
            {titles}
            {nextLabel ? ` · Next: ${nextLabel}` : ""}
          </p>
        </div>
        {finished[0].workoutId && (
          <Link
            href={`/groups/${groupId}/workouts/${finished[0].workoutId}`}
            className="font-body text-xs text-steel underline underline-offset-2 shrink-0"
          >
            View
          </Link>
        )}
      </div>
    );
  }

  // Two or more programs on the same day: one labelled card each, the first thing to do is the
  // primary action, finished ones collapse to a single checked line.
  if (sessions.length > 1) {
    const firstPlannedIndex = sessions.findIndex((x) => x.status === "planned");
    return (
      <div className="border border-steel/20">
        <p className="font-body text-xs text-steel uppercase tracking-wide px-4 pt-4">
          {dateLabel}
          {readinessChip}
        </p>
        {sessions.map((x, i) => (
          <div key={x.programId} className={i === 0 ? "px-4 pb-4 pt-2" : "px-4 py-4 border-t border-steel/15"}>
            {x.status === "done" ? (
              <Link
                href={`/groups/${groupId}/workouts/${x.workoutId}`}
                className="flex items-center gap-2 min-h-11 font-body text-sm text-steel"
              >
                <Check className="w-4 h-4 text-positive shrink-0" strokeWidth={3} />
                <span className="min-w-0">
                  <span className="uppercase tracking-wide text-xs">{x.heading}</span>
                  <span className="block text-chalk">{x.title} — done</span>
                </span>
              </Link>
            ) : (
              <>
                <p className="font-body text-xs text-rust uppercase tracking-wide">{x.heading}</p>
                <p className="font-display font-bold text-xl uppercase leading-none mt-1">{x.title}</p>
                <div className="mt-3">
                  {x.status === "planned" && (
                    <Link
                      href={`/groups/${groupId}/workouts/${x.workoutId}`}
                      className={
                        isToday && i === firstPlannedIndex
                          ? "w-full h-11 flex items-center justify-center bg-rust text-graphite font-display uppercase text-sm font-bold"
                          : isToday
                          ? "w-full h-11 flex items-center justify-center border border-rust text-rust font-display uppercase text-sm font-bold"
                          : "font-body text-sm text-rust"
                      }
                    >
                      {isToday ? "Start workout" : "View planned workout"}
                    </Link>
                  )}
                  {x.status === "missed" && <p className="font-body text-sm text-steel">Not logged.</p>}
                  {x.status === "locked" && (
                    <p className="font-body text-sm text-steel flex items-center gap-1.5">
                      <Lock className="w-3.5 h-3.5" /> Unlocks {dateLabel}
                    </p>
                  )}
                </div>
              </>
            )}
          </div>
        ))}
      </div>
    );
  }

  // Exactly one program has something today: the same card as always, showing it.
  if (sessions.length === 1) {
    workout = sessions[0];
  }

  if (workout.status === "no-program") {
    return (
      <div className="border border-steel/20 p-4">
        <p className="font-body text-xs text-steel uppercase tracking-wide">
          {dateLabel}
          {readinessChip}
        </p>
        <p className="font-body text-sm text-steel mt-2">
          No program is assigned to you right now. Your coach will add one.
        </p>
      </div>
    );
  }

  // Your active program has no start date/training days set, so it runs
  // in "playlist mode" (same as the Workout tab) — nothing maps to a
  // specific calendar date, so browsing to any date other than today
  // has nothing real to show here.
  if (workout.status === "unscheduled") {
    return (
      <div className="border border-steel/20 p-4">
        <p className="font-body text-xs text-steel uppercase tracking-wide">
          {dateLabel}
          {readinessChip}
        </p>
        <p className="font-body text-sm text-steel mt-2">
          Your program isn&apos;t scheduled by date, so there is nothing on this day. Your next workout is on Today.
        </p>
      </div>
    );
  }

  if (workout.status === "rest") {
    // No scheduled workout today — the hero falls through to the one
    // guaranteed baseline action instead of a dead-end (mobile_home_
    // workout_tab_merge_idea.md's rest-day fallback). Macro targets
    // aren't shown here — on a today rest day, TodayWidget (rendered
    // directly below this card) is the single source for that; on a
    // past/future rest day, ReadOnlyDaySummary owns it instead. Showing
    // them a third time here was a real duplicate, not a second signal.
    return (
      <div className="border border-steel/20 p-4">
        <p className="font-body text-xs text-steel uppercase tracking-wide">
          {dateLabel}
          {readinessChip}
        </p>
        <p className="font-display font-bold text-lg uppercase leading-none mt-1">Rest day</p>

        {canBook && (
          <Link
            href={`/groups/${groupId}/calendar/${dateKey}`}
            className="font-body text-sm text-rust mt-3 inline-block"
          >
            Book a session with your coach &rarr;
          </Link>
        )}
        {canBook && sessionsLeft != null && sessionsLeft > 0 && (
          <p className="font-body text-xs text-steel mt-1">{sessionBalanceLine(sessionsLeft)}</p>
        )}
      </div>
    );
  }

  const isPrimary = isToday && workout.status === "planned";

  return (
    <div className="border border-steel/20 p-4">
      <p className="font-body text-xs text-steel uppercase tracking-wide">
        {dateLabel}
        {readinessChip}
      </p>
      <p className="font-display font-bold text-xl uppercase leading-none mt-1">{workout.title}</p>

      <div className="mt-3">
        {workout.status === "done" && workout.workoutId && (
          <Link
            href={`/groups/${groupId}/workouts/${workout.workoutId}`}
            className="font-body text-sm text-positive"
          >
            Completed — view workout
          </Link>
        )}
        {workout.status === "done" && !workout.workoutId && (
          <p className="font-body text-sm text-positive">You finished every workout in this program.</p>
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
          <p className="font-body text-xs text-steel uppercase tracking-wide mb-1">Targets</p>
          <div className="grid grid-cols-4 gap-2 text-center mb-3">
            <div>
              <p className="font-display text-lg leading-none">{macros!.calories ?? "--"}</p>
              <p className="font-body text-xs text-steel uppercase mt-1">Kcal</p>
            </div>
            <div>
              <p className="font-display text-lg leading-none">{macros!.proteinG ?? "--"}</p>
              <p className="font-body text-xs text-steel uppercase mt-1">Protein</p>
            </div>
            <div>
              <p className="font-display text-lg leading-none">{macros!.carbsG ?? "--"}</p>
              <p className="font-body text-xs text-steel uppercase mt-1">Carbs</p>
            </div>
            <div>
              <p className="font-display text-lg leading-none">{macros!.fatG ?? "--"}</p>
              <p className="font-body text-xs text-steel uppercase mt-1">Fat</p>
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
