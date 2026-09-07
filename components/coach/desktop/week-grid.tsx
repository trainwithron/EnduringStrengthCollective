"use client";

import { useState } from "react";
import { createBrowserClient } from "@/lib/supabase/client";
import type { BuilderDay } from "@/lib/types";
import { DayCard } from "./day-card";
import { DuplicateWeekPanel } from "./duplicate-week-panel";
import type { MovementPatternOption } from "../exercise-builder-card";
import { ChevronDown, ChevronUp } from "lucide-react";

export function WeekGrid({
  weekNumber,
  days,
  programId,
  groupId,
  exerciseLibrary,
  movementPatterns,
  expanded,
  scheduledDateByDayId,
  existingWeekNumbers,
  onToggle,
  onDaysChange,
  onWeeksGenerated,
}: {
  weekNumber: number;
  days: BuilderDay[];
  programId: string;
  groupId: string;
  exerciseLibrary: string[];
  movementPatterns: MovementPatternOption[];
  expanded: boolean;
  scheduledDateByDayId?: Map<string, Date>;
  existingWeekNumbers: number[];
  onToggle: () => void;
  onDaysChange: (days: BuilderDay[]) => void;
  onWeeksGenerated: (newDays: BuilderDay[]) => void;
}) {
  const [draggedDayId, setDraggedDayId] = useState<string | null>(null);

  async function persistDayOrder(nextDays: BuilderDay[]) {
    const supabase = createBrowserClient();
    await Promise.all(
      nextDays.map((d, i) => supabase.from("workouts").update({ day_index: i + 1 }).eq("id", d.id))
    );
  }

  function handleDrop(targetId: string) {
    if (!draggedDayId || draggedDayId === targetId) {
      setDraggedDayId(null);
      return;
    }
    const fromIndex = days.findIndex((d) => d.id === draggedDayId);
    const toIndex = days.findIndex((d) => d.id === targetId);
    if (fromIndex === -1 || toIndex === -1) {
      setDraggedDayId(null);
      return;
    }
    const next = days.slice();
    const [moved] = next.splice(fromIndex, 1);
    next.splice(toIndex, 0, moved);
    const reindexed = next.map((d, i) => ({ ...d, dayIndex: i + 1 }));
    onDaysChange(reindexed);
    persistDayOrder(reindexed);
    setDraggedDayId(null);
  }

  async function handleAddDay() {
    const supabase = createBrowserClient();
    const nextDayIndex = days.length > 0 ? Math.max(...days.map((d) => d.dayIndex)) + 1 : 1;

    const { data: newRow } = await supabase
      .from("workouts")
      .insert({
        program_id: programId,
        group_id: groupId,
        title: `Day ${nextDayIndex}`,
        week_number: weekNumber,
        day_index: nextDayIndex,
      })
      .select("id, title, week_number, day_index")
      .single();

    if (!newRow) return;

    onDaysChange([
      ...days,
      {
        id: newRow.id,
        title: newRow.title,
        weekNumber: newRow.week_number,
        dayIndex: newRow.day_index,
        items: [],
      },
    ]);
  }

  const sortedDays = days.slice().sort((a, b) => a.dayIndex - b.dayIndex);

  return (
    <div className="border border-steel/20">
      <button
        type="button"
        onClick={onToggle}
        className="w-full flex items-center justify-between px-5 py-3 active:bg-surface/40 transition-colors"
      >
        <span className="font-display uppercase text-sm tracking-wide text-steel">
          Week {weekNumber}
        </span>
        {expanded ? (
          <ChevronUp className="w-4 h-4 text-steel" />
        ) : (
          <ChevronDown className="w-4 h-4 text-steel" />
        )}
      </button>

      <div className="px-5 pb-3">
        <DuplicateWeekPanel
          programId={programId}
          groupId={groupId}
          sourceWeekNumber={weekNumber}
          sourceDays={days}
          existingWeekNumbers={existingWeekNumbers}
          onGenerated={onWeeksGenerated}
        />
      </div>

      {expanded && (
        <div className="p-5 pt-0">
          <div className="grid gap-4 grid-cols-[repeat(auto-fill,minmax(300px,1fr))]">
            {sortedDays.map((day) => (
              <div
                key={day.id}
                draggable
                onDragStart={() => setDraggedDayId(day.id)}
                onDragEnd={() => setDraggedDayId(null)}
                onDragOver={(e) => e.preventDefault()}
                onDrop={() => handleDrop(day.id)}
                className={draggedDayId === day.id ? "opacity-50" : ""}
              >
                <DayCard
                  day={day}
                  scheduledDate={scheduledDateByDayId?.get(day.id)}
                  groupId={groupId}
                  exerciseLibrary={exerciseLibrary}
                  movementPatterns={movementPatterns}
                  onUpdate={(patch) =>
                    onDaysChange(days.map((d) => (d.id === day.id ? { ...d, ...patch } : d)))
                  }
                  onItemsChange={(items) =>
                    onDaysChange(days.map((d) => (d.id === day.id ? { ...d, items } : d)))
                  }
                  onDeleted={() => onDaysChange(days.filter((d) => d.id !== day.id))}
                />
              </div>
            ))}

            <button
              type="button"
              onClick={handleAddDay}
              className="min-h-[120px] border border-dashed border-steel/30 text-steel font-body text-sm active:border-rust active:text-rust transition-colors"
            >
              + Day
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
