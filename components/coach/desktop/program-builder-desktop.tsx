"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { createBrowserClient } from "@/lib/supabase/client";
import type { BuilderDay } from "@/lib/types";
import { WeekGrid } from "./week-grid";
import { ProgramScheduleSettings } from "../program-schedule-settings";
import { computeScheduledDates, type VisibilityWindow } from "@/lib/program-schedule";
import type { MovementPatternOption } from "../exercise-builder-card";

export function ProgramBuilderDesktop({
  programId,
  groupId,
  programName,
  programDescription,
  initialDays,
  exerciseLibrary,
  movementPatterns,
  initialStartDate,
  initialTrainingDays,
  initialVisibilityWindow,
}: {
  programId: string;
  groupId: string;
  programName: string;
  programDescription: string | null;
  initialDays: BuilderDay[];
  exerciseLibrary: string[];
  movementPatterns: MovementPatternOption[];
  initialStartDate: string | null;
  initialTrainingDays: number[] | null;
  initialVisibilityWindow: VisibilityWindow;
}) {
  const [days, setDays] = useState<BuilderDay[]>(initialDays);
  const [startDate, setStartDate] = useState(initialStartDate);
  const [trainingDays, setTrainingDays] = useState(initialTrainingDays);

  const scheduledDateByDayId = useMemo(() => {
    if (!startDate || !trainingDays || trainingDays.length === 0) return new Map<string, Date>();
    const ordered = days
      .slice()
      .sort((a, b) => a.weekNumber - b.weekNumber || a.dayIndex - b.dayIndex);
    return computeScheduledDates(startDate, trainingDays, ordered);
  }, [days, startDate, trainingDays]);

  const [expandedWeeks, setExpandedWeeks] = useState<Set<number>>(() => {
    const weekNumbers = initialDays.map((d) => d.weekNumber);
    return new Set(weekNumbers.length > 0 ? [Math.min(...weekNumbers)] : []);
  });

  function toggleWeek(weekNumber: number) {
    setExpandedWeeks((prev) => {
      const next = new Set(prev);
      if (next.has(weekNumber)) {
        next.delete(weekNumber);
      } else {
        next.add(weekNumber);
      }
      return next;
    });
  }

  async function handleAddWeek() {
    const weekNumbers = Array.from(new Set(days.map((d) => d.weekNumber)));
    const nextWeek = weekNumbers.length > 0 ? Math.max(...weekNumbers) + 1 : 1;

    const supabase = createBrowserClient();
    const { data: newRow } = await supabase
      .from("workouts")
      .insert({
        program_id: programId,
        group_id: groupId,
        title: "Day 1",
        week_number: nextWeek,
        day_index: 1,
      })
      .select("id, title, week_number, day_index")
      .single();

    if (!newRow) return;

    setDays((prev) => [
      ...prev,
      {
        id: newRow.id,
        title: newRow.title,
        weekNumber: newRow.week_number,
        dayIndex: newRow.day_index,
        items: [],
      },
    ]);
    setExpandedWeeks((prev) => new Set(prev).add(nextWeek));
  }

  const weekNumbers = Array.from(new Set(days.map((d) => d.weekNumber))).sort((a, b) => a - b);
  const nextWeekNumber = weekNumbers.length > 0 ? Math.max(...weekNumbers) + 1 : 1;

  return (
    <div>
      <div className="pb-6 border-b border-steel/20 mb-6">
        <h1 className="font-display font-bold text-3xl uppercase leading-none">{programName}</h1>
        {programDescription && (
          <p className="font-body text-sm text-steel mt-2 max-w-[70ch]">{programDescription}</p>
        )}
        <div className="flex flex-wrap gap-3 mt-4">
          <Link
            href={`/groups/${groupId}/programs/${programId}/progressions`}
            className="inline-flex items-center h-9 font-body text-xs text-rust border border-rust px-3"
          >
            Exercise Progressions
          </Link>
          {startDate && trainingDays && trainingDays.length > 0 && (
            <Link
              href={`/groups/${groupId}/programs/${programId}/calendar`}
              className="inline-flex items-center h-9 font-body text-xs text-rust border border-rust px-3"
            >
              View as calendar &rarr;
            </Link>
          )}
        </div>
      </div>

      <div className="mb-6 border border-steel/20">
        <ProgramScheduleSettings
          programId={programId}
          initialStartDate={initialStartDate}
          initialTrainingDays={initialTrainingDays}
          initialVisibilityWindow={initialVisibilityWindow}
          onChange={(nextStartDate, nextTrainingDays) => {
            setStartDate(nextStartDate);
            setTrainingDays(nextTrainingDays);
          }}
        />
      </div>

      {weekNumbers.length === 0 && (
        <p className="font-body text-sm text-steel py-4">No weeks yet. Add the first one below.</p>
      )}

      <div className="space-y-4">
        {weekNumbers.map((wn) => (
          <WeekGrid
            key={wn}
            weekNumber={wn}
            days={days.filter((d) => d.weekNumber === wn)}
            programId={programId}
            groupId={groupId}
            exerciseLibrary={exerciseLibrary}
            movementPatterns={movementPatterns}
            expanded={expandedWeeks.has(wn)}
            scheduledDateByDayId={scheduledDateByDayId}
            existingWeekNumbers={weekNumbers}
            onToggle={() => toggleWeek(wn)}
            onDaysChange={(weekDays) =>
              setDays((prev) => [...prev.filter((d) => d.weekNumber !== wn), ...weekDays])
            }
            onWeeksGenerated={(newDays) => {
              setDays((prev) => [...prev, ...newDays]);
              setExpandedWeeks((prev) => {
                const next = new Set(prev);
                newDays.forEach((d) => next.add(d.weekNumber));
                return next;
              });
            }}
            onWeekDeleted={() => {
              setDays((prev) => prev.filter((d) => d.weekNumber !== wn));
              setExpandedWeeks((prev) => {
                const next = new Set(prev);
                next.delete(wn);
                return next;
              });
            }}
          />
        ))}
      </div>

      <div className="pt-4">
        <button
          type="button"
          onClick={handleAddWeek}
          className="w-full h-11 border border-steel/30 text-steel font-body text-sm active:border-rust active:text-rust transition-colors"
        >
          + Add Week {nextWeekNumber}
        </button>
      </div>
    </div>
  );
}
