"use client";

import { useState } from "react";
import Link from "next/link";
import { AssignWorkoutForm, type WorkoutOption } from "./assign-workout-form";
import { DailyMacrosForm } from "./daily-macros-form";
import { DayHabitsPanel } from "./day-habits-panel";
import { DaySchedulePanel } from "./day-schedule-panel";

const WEEKDAY_LABELS = ["Su", "Mo", "Tu", "We", "Th", "Fr", "Sa"];

export interface DayCellData {
  dateKey: string;
  dayNumber: number;
  isToday: boolean;
  overrideTitle: string | null;
  assignmentWorkoutId: string | null;
  assignmentNote: string;
  programWorkoutTitle: string | null;
  workoutDone: boolean;
  macros: { calories: number | null; proteinG: number | null; carbsG: number | null; fatG: number | null } | null;
  mealPlan: { mealCount: number; includeSnack: boolean } | null;
  bookingCount: number;
  cellDueHabits: { id: string; title: string; completed: boolean }[];
  panelDueHabits: { id: string; title: string; completed: boolean }[];
}

// Replaces the old day-click-navigates-away pattern: clicking a day
// expands it inline, right in the month grid, showing the same
// workout/macros/habits editing the dedicated day page has — only one
// day open at a time (an accordion), so quick-editing several days in a
// row doesn't mean bouncing back and forth to a separate route each
// time. The dedicated /calendar/{date} page still exists and still
// works (linked from the expanded panel) for anyone who wants it
// directly, e.g. from a notification.
export function ClientCalendarGrid({
  groupId,
  athleteId,
  backHref,
  weeks,
  cellData,
  macrosEnabled,
  workoutOptions,
  latestBodyWeight,
}: {
  groupId: string;
  athleteId: string;
  backHref: string;
  weeks: (string | null)[][];
  cellData: Record<string, DayCellData>;
  macrosEnabled: boolean;
  workoutOptions: WorkoutOption[];
  latestBodyWeight: number | null;
}) {
  const [expandedKey, setExpandedKey] = useState<string | null>(null);

  function toggle(key: string) {
    setExpandedKey((current) => (current === key ? null : key));
  }

  return (
    <div className="border border-steel/15">
      <div className="grid grid-cols-7 gap-px bg-steel/15">
        {WEEKDAY_LABELS.map((label) => (
          <div
            key={label}
            className="bg-graphite text-center font-body text-[10px] text-steel uppercase tracking-wide py-1.5"
          >
            {label}
          </div>
        ))}
      </div>

      {weeks.map((week, weekIndex) => {
        const expandedInThisWeek = week.includes(expandedKey);
        const expandedData = expandedKey ? cellData[expandedKey] : null;

        return (
          <div key={weekIndex}>
            <div className="grid grid-cols-7 gap-px bg-steel/15">
              {week.map((key, i) => {
                if (!key) return <div key={i} className="bg-graphite min-h-[92px]" />;
                const d = cellData[key];
                const isExpanded = key === expandedKey;

                return (
                  <button
                    key={key}
                    type="button"
                    onClick={() => toggle(key)}
                    className={`bg-graphite min-h-[92px] p-1.5 flex flex-col gap-0.5 text-left hover:bg-surface/40 transition-colors ${
                      d.isToday ? "ring-1 ring-inset ring-rust" : ""
                    } ${isExpanded ? "bg-surface/50 ring-1 ring-inset ring-chalk/30" : ""}`}
                  >
                    <div className="flex items-center justify-between">
                      <span
                        className={`font-body text-[10px] ${d.isToday ? "text-rust font-bold" : "text-steel"}`}
                      >
                        {d.dayNumber}
                      </span>
                      <div className="flex items-center gap-1.5">
                        {d.mealPlan && (
                          <span
                            className="font-body text-[9px] text-steel"
                            title={`${d.mealPlan.mealCount} meals${d.mealPlan.includeSnack ? " + snack" : ""}`}
                          >
                            🍽
                          </span>
                        )}
                        {d.bookingCount > 0 && (
                          <span className="font-body text-[9px] text-steel">📅 {d.bookingCount}</span>
                        )}
                      </div>
                    </div>
                    {d.overrideTitle ? (
                      <span className="font-body text-[10px] leading-tight text-rust">{d.overrideTitle}</span>
                    ) : d.programWorkoutTitle ? (
                      <span
                        className={`font-body text-[10px] leading-tight ${
                          d.workoutDone ? "text-positive" : "text-chalk"
                        }`}
                      >
                        {d.programWorkoutTitle}
                      </span>
                    ) : null}
                    {d.macros?.calories != null && (
                      <span className="font-body text-[9px] text-steel">
                        {d.macros.calories}cal
                        {d.macros.proteinG != null && ` ${d.macros.proteinG}p`}
                        {d.macros.carbsG != null && ` ${d.macros.carbsG}c`}
                        {d.macros.fatG != null && ` ${d.macros.fatG}f`}
                      </span>
                    )}
                    {d.cellDueHabits.slice(0, 2).map((h) => (
                      <span
                        key={h.id}
                        className={`font-body text-[9px] leading-tight truncate ${
                          h.completed ? "text-positive" : "text-steel"
                        }`}
                      >
                        {h.completed ? "✓ " : "· "}
                        {h.title}
                      </span>
                    ))}
                    {d.cellDueHabits.length > 2 && (
                      <span className="font-body text-[9px] text-steel">
                        +{d.cellDueHabits.length - 2} more
                      </span>
                    )}
                  </button>
                );
              })}
            </div>

            {expandedInThisWeek && expandedData && (
              <div className="border-t border-b border-steel/20 bg-graphite p-4">
                <div className="flex items-center justify-between mb-4">
                  <h3 className="font-display uppercase text-sm tracking-wide">
                    {new Date(`${expandedData.dateKey}T00:00:00`).toLocaleDateString("en-US", {
                      weekday: "long",
                      month: "long",
                      day: "numeric",
                    })}
                  </h3>
                  <div className="flex items-center gap-3">
                    <Link
                      href={`${backHref}/calendar/${expandedData.dateKey}`}
                      className="font-body text-xs text-rust uppercase tracking-wide"
                    >
                      Open full page ↗
                    </Link>
                    <button
                      type="button"
                      onClick={() => setExpandedKey(null)}
                      className="font-body text-xs text-steel uppercase tracking-wide"
                    >
                      Close ✕
                    </button>
                  </div>
                </div>

                <div className="grid grid-cols-3 gap-6">
                  <section>
                    <h4 className="font-display uppercase text-xs tracking-wide text-steel mb-3">
                      Workout
                    </h4>
                    {expandedData.programWorkoutTitle && (
                      <p className="font-body text-xs text-steel mb-2">
                        Program default: <span className="text-chalk">{expandedData.programWorkoutTitle}</span>
                      </p>
                    )}
                    <AssignWorkoutForm
                      key={expandedData.dateKey}
                      athleteId={athleteId}
                      groupId={groupId}
                      date={expandedData.dateKey}
                      options={workoutOptions}
                      initialWorkoutId={expandedData.assignmentWorkoutId}
                      initialNote={expandedData.assignmentNote}
                    />
                  </section>

                  <section>
                    <h4 className="font-display uppercase text-xs tracking-wide text-steel mb-3">
                      Daily macros
                    </h4>
                    {macrosEnabled ? (
                      <DailyMacrosForm
                        key={expandedData.dateKey}
                        athleteId={athleteId}
                        groupId={groupId}
                        date={expandedData.dateKey}
                        initial={{
                          calories: expandedData.macros?.calories ?? null,
                          proteinG: expandedData.macros?.proteinG ?? null,
                          carbsG: expandedData.macros?.carbsG ?? null,
                          fatG: expandedData.macros?.fatG ?? null,
                        }}
                        latestBodyWeight={latestBodyWeight}
                      />
                    ) : (
                      <p className="font-body text-xs text-steel">
                        Not included for this client&apos;s tier (Group).
                      </p>
                    )}
                  </section>

                  <section>
                    <h4 className="font-display uppercase text-xs tracking-wide text-steel mb-3">
                      Habits due
                    </h4>
                    <DayHabitsPanel
                      key={expandedData.dateKey}
                      athleteId={athleteId}
                      groupId={groupId}
                      date={expandedData.dateKey}
                      dueHabits={expandedData.panelDueHabits}
                    />
                  </section>
                </div>

                <div className="mt-6 pt-4 border-t border-steel/15">
                  <h4 className="font-display uppercase text-xs tracking-wide text-steel mb-3">
                    Your schedule this day
                  </h4>
                  <DaySchedulePanel key={expandedData.dateKey} date={expandedData.dateKey} />
                </div>
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
