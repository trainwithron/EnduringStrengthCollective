"use client";

import { useState } from "react";
import { createBrowserClient } from "@/lib/supabase/client";
import type { BuilderDay, BuilderExercise } from "@/lib/types";
import { DayCard } from "./day-card";
import { DuplicateWeekPanel } from "./duplicate-week-panel";
import { BulkEditDayPanel } from "./bulk-edit-day-panel";
import { TARGET_PROP, type TrackedField } from "@/lib/exercise-fields";
import type { MovementPatternOption } from "../exercise-builder-card";
import { ChevronDown, ChevronUp } from "lucide-react";
import { flashSaved } from "@/lib/save-toast";

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
  onWeekDeleted,
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
  onWeekDeleted: () => void;
}) {
  const [draggedDayId, setDraggedDayId] = useState<string | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const [daysCondensed, setDaysCondensed] = useState(false);
  // Guards handleAddDay against a real race: it computes day_index off the
  // `days` closure, stale until the parent re-renders with the new array.
  // A fast double-click on "+ Day" would otherwise insert two workouts
  // with the same day_index (found and fixed for the analogous per-set
  // bug tonight).
  const [addDayBusy, setAddDayBusy] = useState(false);

  async function handleDeleteWeek() {
    if (
      !window.confirm(
        `Delete all of Week ${weekNumber} (${days.length} ${days.length === 1 ? "day" : "days"})? This can't be undone. Any client who already logged one of these workouts keeps that history — this only removes the templates.`
      )
    ) {
      return;
    }
    setDeleting(true);
    setDeleteError(null);
    const supabase = createBrowserClient();
    const { error } = await supabase
      .from("workouts")
      .delete()
      .eq("program_id", programId)
      .eq("week_number", weekNumber);

    if (error) {
      setDeleteError("Couldn't delete — try again.");
      setDeleting(false);
      return;
    }

    onWeekDeleted();
  }

  async function persistDayOrder(nextDays: BuilderDay[]) {
    const supabase = createBrowserClient();
    await Promise.all(
      nextDays.map((d, i) => supabase.from("workouts").update({ day_index: i + 1 }).eq("id", d.id))
    );
    flashSaved();
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
    if (addDayBusy) return;
    setAddDayBusy(true);
    try {
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
      flashSaved();
    } finally {
      setAddDayBusy(false);
    }
  }

  const sortedDays = days.slice().sort((a, b) => a.dayIndex - b.dayIndex);
  const weekExercises: BuilderExercise[] = days.flatMap((d) =>
    d.items.filter((i): i is BuilderExercise => i.kind === "exercise")
  );

  function handleWeekBulkApplied(
    updates: { exerciseId: string; field: TrackedField; value: string | number | null }[]
  ) {
    const byExercise = new Map(updates.map((u) => [u.exerciseId, u]));
    onDaysChange(
      days.map((day) => ({
        ...day,
        items: day.items.map((item) => {
          if (item.kind !== "exercise") return item;
          const update = byExercise.get(item.id);
          if (!update) return item;
          const prop = TARGET_PROP[update.field] as keyof BuilderExercise["sets"][number];
          return { ...item, sets: item.sets.map((s) => ({ ...s, [prop]: update.value })) };
        }),
      }))
    );
  }

  return (
    <div className="border border-steel/20">
      <div className="w-full flex items-center gap-2 px-5 py-3">
        <button
          type="button"
          onClick={onToggle}
          className="flex-1 flex items-center justify-between active:bg-surface/40 transition-colors"
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
        <button
          type="button"
          onClick={() => setDaysCondensed((v) => !v)}
          className="font-body text-xs text-steel active:text-rust transition-colors shrink-0"
        >
          {daysCondensed ? "Expand days" : "Collapse days"}
        </button>
        <button
          type="button"
          onClick={handleDeleteWeek}
          disabled={deleting}
          className="font-body text-xs text-steel active:text-rust transition-colors shrink-0 disabled:opacity-40"
        >
          Delete week
        </button>
      </div>

      {deleteError && (
        <p className="font-body text-xs text-rust px-5 pb-2" role="alert">
          {deleteError}
        </p>
      )}

      <div className="px-5 pb-3 flex flex-wrap gap-2">
        <DuplicateWeekPanel
          programId={programId}
          groupId={groupId}
          sourceWeekNumber={weekNumber}
          sourceDays={days}
          existingWeekNumbers={existingWeekNumbers}
          onGenerated={onWeeksGenerated}
        />
        <BulkEditDayPanel
          exercises={weekExercises}
          onApplied={handleWeekBulkApplied}
          label="Bulk edit week"
        />
      </div>

      {expanded && (
        <div className="p-5 pt-0">
          {/* A week is always one horizontal row — extra days scroll
              left/right instead of wrapping to a second line, so the
              whole week reads as a single level regardless of day count. */}
          <div className="flex gap-4 overflow-x-auto pb-2">
            {sortedDays.map((day) => (
              <div
                key={day.id}
                draggable
                onDragStart={() => setDraggedDayId(day.id)}
                onDragEnd={() => setDraggedDayId(null)}
                onDragOver={(e) => e.preventDefault()}
                onDrop={() => handleDrop(day.id)}
                className={`w-[320px] shrink-0 ${draggedDayId === day.id ? "opacity-50" : ""}`}
              >
                <DayCard
                  day={day}
                  scheduledDate={scheduledDateByDayId?.get(day.id)}
                  groupId={groupId}
                  exerciseLibrary={exerciseLibrary}
                  movementPatterns={movementPatterns}
                  condensed={daysCondensed}
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
              disabled={addDayBusy}
              className="w-[320px] shrink-0 min-h-[120px] border border-dashed border-steel/30 text-steel font-body text-sm active:border-rust active:text-rust transition-colors disabled:opacity-40"
            >
              + Day
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
