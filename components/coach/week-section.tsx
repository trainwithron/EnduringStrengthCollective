"use client";

import { useState } from "react";
import { createBrowserClient } from "@/lib/supabase/client";
import type { BuilderDay } from "@/lib/types";
import { DayColumn } from "./day-column";
import type { MovementPatternOption } from "./exercise-builder-card";
import { ChevronDown, ChevronUp } from "lucide-react";

export function WeekSection({
  weekNumber,
  days,
  programId,
  groupId,
  exerciseLibrary,
  movementPatterns,
  expanded,
  scheduledDateByDayId,
  cardWidthPx,
  onCardWidthChange,
  onToggle,
  onDaysChange,
}: {
  weekNumber: number;
  days: BuilderDay[];
  programId: string;
  groupId: string;
  exerciseLibrary: string[];
  movementPatterns: MovementPatternOption[];
  expanded: boolean;
  scheduledDateByDayId?: Map<string, Date>;
  cardWidthPx: number;
  onCardWidthChange: (px: number, commit: boolean) => void;
  onToggle: () => void;
  onDaysChange: (days: BuilderDay[]) => void;
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

  // Up/down fallback for whole-day reordering — same reasoning as the
  // exercise/note fallback in DayColumn: drag-and-drop doesn't work on a
  // touchscreen.
  function moveDay(sortedList: BuilderDay[], index: number, direction: -1 | 1) {
    const target = index + direction;
    if (target < 0 || target >= sortedList.length) return;
    const next = sortedList.slice();
    [next[index], next[target]] = [next[target], next[index]];
    const reindexed = next.map((d, i) => ({ ...d, dayIndex: i + 1 }));
    onDaysChange(reindexed);
    persistDayOrder(reindexed);
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
    <div className="border-b border-steel/20">
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

      {expanded && (
        <div className="pb-4 pl-5">
          <div className="flex gap-3 overflow-x-auto pb-2 pr-5">
            {sortedDays.map((day, index) => (
              <div
                key={day.id}
                draggable
                onDragStart={() => setDraggedDayId(day.id)}
                onDragEnd={() => setDraggedDayId(null)}
                onDragOver={(e) => e.preventDefault()}
                onDrop={() => handleDrop(day.id)}
                className={draggedDayId === day.id ? "opacity-50" : ""}
              >
                <DayColumn
                  day={day}
                  scheduledDate={scheduledDateByDayId?.get(day.id)}
                  groupId={groupId}
                  exerciseLibrary={exerciseLibrary}
                  movementPatterns={movementPatterns}
                  cardWidthPx={cardWidthPx}
                  onCardWidthChange={onCardWidthChange}
                  canMoveLeft={index > 0}
                  canMoveRight={index < sortedDays.length - 1}
                  onMoveLeft={() => moveDay(sortedDays, index, -1)}
                  onMoveRight={() => moveDay(sortedDays, index, 1)}
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
              className="w-16 shrink-0 self-stretch border border-dashed border-steel/30 text-steel font-body text-xs active:border-rust active:text-rust transition-colors"
            >
              + Day
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
