"use client";

import { useEffect, useMemo, useState } from "react";
import { createBrowserClient } from "@/lib/supabase/client";
import type { BuilderDay } from "@/lib/types";
import { WeekSection } from "./week-section";
import { ProgramScheduleSettings } from "./program-schedule-settings";
import { computeScheduledDates } from "@/lib/program-schedule";
import type { MovementPatternOption } from "./exercise-builder-card";
import {
  CARD_WIDTH_PRESETS,
  CARD_WIDTH_STORAGE_KEY,
  clampCardWidth,
  type CardWidthKey,
} from "@/lib/builder-prefs";

export function ProgramBuilder({
  programId,
  groupId,
  initialDays,
  exerciseLibrary,
  movementPatterns,
  initialStartDate,
  initialTrainingDays,
}: {
  programId: string;
  groupId: string;
  initialDays: BuilderDay[];
  exerciseLibrary: string[];
  movementPatterns: MovementPatternOption[];
  initialStartDate: string | null;
  initialTrainingDays: number[] | null;
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
  // Collapsed by default, purely user-toggled — only the earliest week
  // starts expanded so there's something to look at on first load.
  const [expandedWeeks, setExpandedWeeks] = useState<Set<number>>(() => {
    const weekNumbers = initialDays.map((d) => d.weekNumber);
    return new Set(weekNumbers.length > 0 ? [Math.min(...weekNumbers)] : []);
  });

  // Defaults to "normal" during SSR/first paint, then picks up the coach's
  // remembered preference after mount — avoids a localStorage read during
  // server rendering (which would throw) or a hydration mismatch.
  const [cardWidthPx, setCardWidthPxState] = useState<number>(CARD_WIDTH_PRESETS.normal);
  useEffect(() => {
    try {
      const stored = Number(localStorage.getItem(CARD_WIDTH_STORAGE_KEY));
      if (Number.isFinite(stored) && stored > 0) setCardWidthPxState(clampCardWidth(stored));
    } catch {
      // localStorage unavailable (private browsing, etc.) — just keep "normal".
    }
  }, []);

  // Drag-resize calls this on every pointer move (commit: false) for a live
  // preview, then once more on release (commit: true) to persist. Preset
  // buttons always commit immediately.
  function handleCardWidthChange(px: number, commit: boolean) {
    const next = clampCardWidth(px);
    setCardWidthPxState(next);
    if (commit) {
      try {
        localStorage.setItem(CARD_WIDTH_STORAGE_KEY, String(next));
      } catch {
        // Not persisted this session, but the in-memory change still applies.
      }
    }
  }

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
      <ProgramScheduleSettings
        programId={programId}
        initialStartDate={initialStartDate}
        initialTrainingDays={initialTrainingDays}
        onChange={(nextStartDate, nextTrainingDays) => {
          setStartDate(nextStartDate);
          setTrainingDays(nextTrainingDays);
        }}
      />

      <div className="px-5 pt-4 flex items-center gap-2">
        <span className="font-body text-xs text-steel uppercase tracking-wide">
          Card width
        </span>
        {(Object.keys(CARD_WIDTH_PRESETS) as CardWidthKey[]).map((key) => (
          <button
            key={key}
            type="button"
            onClick={() => handleCardWidthChange(CARD_WIDTH_PRESETS[key], true)}
            className={`h-8 px-3 border font-body text-xs capitalize transition-colors ${
              cardWidthPx === CARD_WIDTH_PRESETS[key]
                ? "bg-rust border-rust text-graphite"
                : "border-steel/30 text-steel active:border-rust active:text-rust"
            }`}
          >
            {key}
          </button>
        ))}
        <span className="font-body text-xs text-steel">
          or drag a column&apos;s right edge
        </span>
      </div>

      {weekNumbers.length === 0 && (
        <p className="font-body text-sm text-steel px-5 py-4">
          No weeks yet. Add the first one below.
        </p>
      )}

      {weekNumbers.map((wn) => (
        <WeekSection
          key={wn}
          weekNumber={wn}
          days={days.filter((d) => d.weekNumber === wn)}
          programId={programId}
          groupId={groupId}
          exerciseLibrary={exerciseLibrary}
          movementPatterns={movementPatterns}
          expanded={expandedWeeks.has(wn)}
          scheduledDateByDayId={scheduledDateByDayId}
          cardWidthPx={cardWidthPx}
          onCardWidthChange={handleCardWidthChange}
          onToggle={() => toggleWeek(wn)}
          onDaysChange={(weekDays) =>
            setDays((prev) => [...prev.filter((d) => d.weekNumber !== wn), ...weekDays])
          }
        />
      ))}

      <div className="px-5 pt-4 pb-24">
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
