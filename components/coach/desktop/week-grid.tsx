"use client";

import { confirmDialog } from "@/components/shared/confirm-dialog";
import { insertProgramDay, saveDayOrder } from "@/lib/program-days";
import type { DemoRow } from "@/lib/exercise-demo";
import { NONE_COLLAPSED, allCollapsed, toggleAll, toggleCollapsed } from "@/lib/collapse-state";
import { ClientPreviewButton } from "@/components/coach/desktop/client-preview";
import { useEffect, useState } from "react";
import { readCompact, toggleDay, toggleWeek, writeCompact } from "@/lib/compact-days";
import { createBrowserClient } from "@/lib/supabase/client";
import type { BuilderDay, BuilderExercise } from "@/lib/types";
import { DayCard } from "./day-card";
import { WeekDayRow } from "@/components/coach/desktop/week-day-row";
import { DuplicateWeekPanel } from "./duplicate-week-panel";
import { BulkEditDayPanel } from "./bulk-edit-day-panel";
import { TARGET_PROP, type TrackedField } from "@/lib/exercise-fields";
import type { MovementPatternOption } from "../exercise-builder-card";
import type { AliasEntry } from "@/lib/exercise-matching";
import type { RestTempoSuggestion } from "@/lib/training-intent";
import { ChevronDown, ChevronUp } from "lucide-react";
import { useSaveToastChannel } from "./save-toast-channel";
import { restoreDays } from "@/lib/program-restore";
import { showUndo } from "@/lib/undo-toast";

export function WeekGrid({
  weekNumber,
  days,
  programId,
  groupId,
  athleteId,
  canAddSlot = false,
  exerciseLibrary,
  exerciseAliases,
  exerciseTierByName,
  demoLibrary,
  movementPatterns,
  laddersByPattern,
  restSuggestions,
  expanded,
  scheduledDateByDayId,
  existingWeekNumbers,
  onToggle,
  onDaysChange,
  onWeeksGenerated,
  onWeekDeleted,
  onWeekRestored,
}: {
  weekNumber: number;
  days: BuilderDay[];
  programId: string;
  groupId: string;
  athleteId: string | null;
  canAddSlot?: boolean;
  exerciseLibrary: string[];
  exerciseAliases: AliasEntry[];
  exerciseTierByName: Record<string, "A" | "B" | "C" | null>;
  demoLibrary: DemoRow[];
  movementPatterns: MovementPatternOption[];
  laddersByPattern: Record<string, { exerciseName: string }[]>;
  restSuggestions?: RestTempoSuggestion[];
  expanded: boolean;
  scheduledDateByDayId?: Map<string, Date>;
  existingWeekNumbers: number[];
  onToggle: () => void;
  onDaysChange: (days: BuilderDay[] | ((prev: BuilderDay[]) => BuilderDay[])) => void;
  onWeeksGenerated: (newDays: BuilderDay[]) => void;
  onWeekDeleted: () => void;
  // The week's days put back by "Undo".
  onWeekRestored?: (days: BuilderDay[]) => void;
}) {
  const { flashSaved, flashSaveError } = useSaveToastChannel();
  const [draggedDayId, setDraggedDayId] = useState<string | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  // Which days are in the compact view. Remembered in this browser for this program and week (never saved to the program); read after the first paint so the server and the
  // browser agree on what they draw first.
  const [compactIds, setCompactIdsState] = useState<ReadonlySet<string>>(new Set());
  useEffect(() => {
    try {
      setCompactIdsState(readCompact(window.localStorage, programId, weekNumber));
    } catch {
      // No storage: nothing remembered.
    }
  }, [programId, weekNumber]);
  // Compact days with an exercise open as an editor get a normal-width column, since the editor is built for it.
  const [editingCompactIds, setEditingCompactIds] = useState<ReadonlySet<string>>(new Set());
  function setCompactEditor(dayId: string, open: boolean) {
    setEditingCompactIds((prev) => {
      if (prev.has(dayId) === open) return prev;
      const next = new Set(prev);
      if (open) next.add(dayId);
      else next.delete(dayId);
      return next;
    });
  }
  function setCompactIds(next: Set<string>) {
    setCompactIdsState(next);
    try {
      writeCompact(window.localStorage, programId, weekNumber, next);
    } catch {
      // No storage: it still works for this visit.
    }
  }
  // Every day opens and closes on its own: opening Day 2 leaves Day 1 open, so two or more days can be on screen together while the next one is built. (This used to be an accordion that closed
  // the others, which is why only one day would stay open.) Everything starts open; nothing here is saved.
  const [collapsedDayIds, setCollapsedDayIds] = useState<ReadonlySet<string>>(NONE_COLLAPSED);

  function handleToggleDayCollapse(dayId: string) {
    setCollapsedDayIds((prev) => toggleCollapsed(prev, dayId));
  }
  const dayIds = days.map((d) => d.id);
  // Guards handleAddDay against a real race: it computes day_index off the
  // `days` closure, stale until the parent re-renders with the new array.
  // A fast double-click on "+ Day" would otherwise insert two workouts
  // with the same day_index (found and fixed for the analogous per-set
  // bug tonight).
  const [addDayBusy, setAddDayBusy] = useState(false);

  async function handleDeleteWeek() {
    if (
      !await confirmDialog(
        `Delete all of Week ${weekNumber} (${days.length} ${days.length === 1 ? "day" : "days"})? Any client who already logged one of these workouts keeps that history — this only removes the templates. You can undo this for a few seconds.`
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

    const goneDays = days;
    onWeekDeleted();
    showUndo({
      message: `Deleted Week ${weekNumber}.`,
      onUndo: async () => {
        const back = await restoreDays(supabase, { programId, groupId, days: goneDays });
        if (back) onWeekRestored?.(back);
        else flashSaveError("Couldn't put that week back — add it again.");
      },
    });
  }

  async function persistDayOrder(nextDays: BuilderDay[]) {
    const supabase = createBrowserClient();
    if (!(await saveDayOrder(supabase, nextDays.map((d) => d.id)))) {
      flashSaveError("Couldn't save the new day order — reload to check.");
      return;
    }
    flashSaved();
  }

  // The arrows on a day: swap it with its neighbour in the order shown.
  function moveDay(dayId: string, direction: -1 | 1) {
    const shown = days.slice().sort((a, b) => a.dayIndex - b.dayIndex);
    const from = shown.findIndex((d) => d.id === dayId);
    const to = from + direction;
    if (from === -1 || to < 0 || to >= shown.length) return;
    const next = shown.slice();
    [next[from], next[to]] = [next[to], next[from]];
    const reindexed = next.map((d, i) => ({ ...d, dayIndex: i + 1 }));
    onDaysChange(reindexed);
    persistDayOrder(reindexed);
  }

  function handleDrop(targetId: string) {
    if (!draggedDayId || draggedDayId === targetId) {
      setDraggedDayId(null);
      return;
    }
    // Positions are taken in the order the days are shown (by day number), not in the order the list happens to be stored.
    const shown = days.slice().sort((a, b) => a.dayIndex - b.dayIndex);
    const fromIndex = shown.findIndex((d) => d.id === draggedDayId);
    const toIndex = shown.findIndex((d) => d.id === targetId);
    if (fromIndex === -1 || toIndex === -1) {
      setDraggedDayId(null);
      return;
    }
    const next = shown;
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
      // The next free day number is read from what is saved (not from this screen), and retried if someone else took it at the same moment.
      const { row: newRow, error: insertError } = await insertProgramDay(supabase, { programId, groupId, weekNumber, title: (n) => `Day ${n}` });

      if (insertError || !newRow) {
        flashSaveError(insertError ?? "Couldn't add that day — try again.");
        return;
      }

      onDaysChange((prev) => [
        ...prev,
        {
          id: newRow.id,
          title: newRow.title,
          weekNumber: newRow.week_number,
          dayIndex: newRow.day_index,
          items: [],
          scheduledDate: null,
        },
      ]);
      flashSaved();
    } finally {
      setAddDayBusy(false);
    }
  }

  const sortedDays = days.slice().sort((a, b) => a.dayIndex - b.dayIndex);
  const weekExercises: BuilderExercise[] = days.flatMap((d) =>
    d.items.filter((i): i is BuilderExercise => i.kind === "exercise" && !i.slot)
  );

  function handleWeekBulkApplied(
    updates: { exerciseId: string; field: TrackedField; value: string | number | null; highValue?: number | null; addedField?: boolean }[]
  ) {
    const byExercise = new Map(updates.map((u) => [u.exerciseId, u]));
    onDaysChange((prev) =>
      prev.map((day) => ({
        ...day,
        items: day.items.map((item) => {
          if (item.kind !== "exercise") return item;
          const update = byExercise.get(item.id);
          if (!update) return item;
          const prop = TARGET_PROP[update.field] as keyof BuilderExercise["sets"][number];
          return {
            ...item,
            trackedFields: update.addedField && !item.trackedFields.includes(update.field) ? [...item.trackedFields, update.field] : item.trackedFields,
            sets: item.sets.map((s) => ({ ...s, [prop]: update.value, ...(update.field === "rest" ? { targetRestMaxSeconds: update.highValue ?? null } : {}) })),
          };
        }),
      }))
    );
  }

  return (
    <div className="border border-steel/20">
      <div className="w-full flex flex-wrap items-center gap-x-2 gap-y-1 px-5 py-3">
        <button
          type="button"
          onClick={onToggle}
          className="flex-1 min-w-[8rem] flex items-center justify-between active:bg-surface/40 transition-colors"
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
          onClick={() => setCompactIds(toggleWeek(new Set(compactIds), dayIds))}
          title="Switches every day of this week between one line per exercise and the full editor. A single day can be switched on its own from its header."
          className="font-body text-xs text-steel active:text-rust transition-colors shrink-0"
        >
          {dayIds.length > 0 && dayIds.every((id) => compactIds.has(id)) ? "Full view" : "Compact view"}
        </button>
        <button
          type="button"
          onClick={() => setCollapsedDayIds((prev) => toggleAll(prev, dayIds))}
          disabled={dayIds.length === 0}
          className="font-body text-xs text-steel active:text-rust transition-colors shrink-0 min-h-11 sm:min-h-0 px-1 disabled:opacity-40"
        >
          {allCollapsed(collapsedDayIds, dayIds) ? "Expand all days" : "Collapse all days"}
        </button>
        <ClientPreviewButton days={sortedDays} heading={`Week ${weekNumber}`} label="Preview week" demoLibrary={demoLibrary} />
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
          athleteId={athleteId}
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
          {/* A week is always one horizontal row. The days share the width equally (each at least 300px, at most 420px), so 3 to 5 days fit without
              scrolling on a wide screen; only when they cannot fit does the row scroll, with a thin pan strip above it. */}
          <WeekDayRow>
            {sortedDays.map((day) => (
              <div
                key={day.id}
                draggable
                onDragStart={(e) => {
                  // Only the day itself starts a day drag (an exercise dragged inside it is not a day).
                  if (e.target !== e.currentTarget) return;
                  e.dataTransfer.setData("text/plain", day.id);
                  setDraggedDayId(day.id);
                }}
                onDragEnd={() => setDraggedDayId(null)}
                onDragOver={(e) => {
                  if (draggedDayId) e.preventDefault();
                }}
                onDrop={() => {
                  if (draggedDayId) handleDrop(day.id);
                }}
                className={`flex-[1_1_0%] ${compactIds.has(day.id) && !editingCompactIds.has(day.id) ? "min-w-[220px] max-w-[300px]" : "min-w-[300px] max-w-[420px]"} ${draggedDayId === day.id ? "opacity-50" : ""}`}
              >
                <DayCard
                  day={day}
                  scheduledDate={scheduledDateByDayId?.get(day.id)}
                  groupId={groupId}
                  exerciseLibrary={exerciseLibrary}
                  exerciseAliases={exerciseAliases}
                  exerciseTierByName={exerciseTierByName}
                  demoLibrary={demoLibrary}
                  movementPatterns={movementPatterns}
                  laddersByPattern={laddersByPattern}
                  restSuggestions={restSuggestions}
                  athleteId={athleteId}
                  canAddSlot={canAddSlot}
                  condensed={compactIds.has(day.id)}
                  onToggleCondensed={() => setCompactIds(toggleDay(new Set(compactIds), day.id))}
                  onCompactEditorChange={(open) => setCompactEditor(day.id, open)}
                  collapsed={collapsedDayIds.has(day.id)}
                  onToggleCollapse={() => handleToggleDayCollapse(day.id)}
                  onUpdate={(patch) =>
                    onDaysChange((prev) => prev.map((d) => (d.id === day.id ? { ...d, ...patch } : d)))
                  }
                  onItemsChange={(items) =>
                    onDaysChange((prev) => prev.map((d) => (d.id === day.id ? { ...d, items: typeof items === "function" ? items(d.items) : items } : d)))
                  }
                  onDeleted={() => onDaysChange((prev) => prev.filter((d) => d.id !== day.id))}
                  programId={programId}
                  onRestored={(back) => onDaysChange((prev) => (prev.some((d) => d.id === back.id) ? prev : [...prev, back]))}
                  onMoveEarlier={sortedDays[0]?.id === day.id ? undefined : () => moveDay(day.id, -1)}
                  onMoveLater={sortedDays[sortedDays.length - 1]?.id === day.id ? undefined : () => moveDay(day.id, 1)}
                />
              </div>
            ))}

            <button
              type="button"
              onClick={handleAddDay}
              disabled={addDayBusy}
              className="w-[72px] shrink-0 min-h-[120px] border border-dashed border-steel/30 text-steel font-body text-sm active:border-rust active:text-rust transition-colors disabled:opacity-40"
            >
              + Day
            </button>
          </WeekDayRow>
        </div>
      )}
    </div>
  );
}
