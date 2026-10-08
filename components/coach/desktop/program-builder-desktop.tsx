"use client";

import type { DemoRow } from "@/lib/exercise-demo";
import { useMemo, useState } from "react";
import Link from "next/link";
import { createBrowserClient } from "@/lib/supabase/client";
import type { BuilderDay } from "@/lib/types";
import type { AliasEntry } from "@/lib/exercise-matching";
import { WeekGrid } from "./week-grid";
import { ProgramScheduleSettings } from "../program-schedule-settings";
import { computeScheduledDates, type VisibilityWindow } from "@/lib/program-schedule";
import type { MovementPatternOption } from "../exercise-builder-card";
import { ProgramAssignedClients } from "@/components/coach/desktop/program-assigned-clients";
import { ProgramCardMenu } from "./program-card-menu";
import { SaveToast } from "./save-toast";
import { SaveStatusBar } from "./save-status-bar";
import { SaveToastChannelContext } from "./save-toast-channel";
import { createSaveToastChannel } from "@/lib/save-toast";
import { ProgramChatPanel } from "./program-chat-panel";
import { TrainingIntentSelector } from "../training-intent-selector";
import { REST_TEMPO_SUGGESTIONS, type TrainingIntent } from "@/lib/training-intent";

export function ProgramBuilderDesktop({
  programId,
  groupId,
  athleteId,
  programName,
  programDescription,
  aiSequencingNotes,
  initialDays,
  exerciseLibrary,
  exerciseAliases,
  exerciseTierByName,
  demoLibrary,
  movementPatterns,
  laddersByPattern,
  initialStartDate,
  initialTrainingDays,
  initialVisibilityWindow,
  initialTrainingIntent,
  initialExpandedWeek = null,
  embedded = false,
}: {
  programId: string;
  groupId: string;
  // disconnected_sibling_tools_ux_audit_sept30.md — null for a shared
  // group program (no single athlete to resolve a training max
  // against); set for a personal per-client copy. Threaded down to
  // WeekGrid/DuplicateWeekPanel so "% of training max" can query a real
  // athlete_training_maxes row instead of having no athlete context.
  athleteId: string | null;
  programName: string;
  programDescription: string | null;
  // Only set for an AI-generated program — the "Ask the AI" why/correct
  // chat is grounded in this program's own captured generation notes, so
  // it only makes sense to offer where those notes actually exist.
  aiSequencingNotes: string | null;
  initialDays: BuilderDay[];
  exerciseLibrary: string[];
  exerciseAliases: AliasEntry[];
  // Same A/B/C class each exercise's own row already resolves by name
  // (movement-pattern ladder tier) — surfaced in the exercise search
  // dropdown too, so picking a suggested name and seeing its tier are the
  // same moment instead of two separate lookups.
  exerciseTierByName: Record<string, "A" | "B" | "C" | null>;
  demoLibrary: DemoRow[];
  movementPatterns: MovementPatternOption[];
  // exercise_tier_template_system_assessment_task.md — every ladder rung
  // for every pattern this coach owns, keyed by movement_pattern_id, so
  // the exercise card can offer a one-tap swap the moment a pattern is
  // tagged instead of only on the separate per-client override page.
  laddersByPattern: Record<string, { exerciseName: string }[]>;
  initialStartDate: string | null;
  initialTrainingDays: number[] | null;
  initialVisibilityWindow: VisibilityWindow;
  initialTrainingIntent: TrainingIntent | null;
  // Programs mini-view polish — a week number to auto-expand on load
  // (from the mini-view's own `?week=N` link), so jumping here from a
  // specific day in the condensed card-stack view actually lands you on
  // that week already open instead of back at the top of the builder.
  // Null for the normal, un-deep-linked case.
  initialExpandedWeek?: number | null;
  // Real feedback from Ron: the embedded copy inside ShellListPanel's
  // resizable side panel should stay scoped to editing THIS one program
  // — "Assign to Client"/"Duplicate" (which navigate to a brand-new
  // program's own builder) don't make sense from inside a panel that's
  // meant to keep you on your current page. Delete stays available; it's
  // a real in-place action on this same program.
  embedded?: boolean;
}) {
  // Own channel per mount — fixes a real bug (see lib/save-toast.ts's
  // createSaveToastChannel doc comment): the full-page builder and an
  // embedded ShellListPanel copy of a DIFFERENT program can be mounted
  // at once, and a shared global save-toast bus meant editing one
  // flashed a false "Saved ✓" on the other's status bar too. Every
  // descendant (day-card, week-grid, exercise rows, etc.) reads this
  // same instance via SaveToastChannelContext instead of importing the
  // old global flashSaved/flashSaveError directly.
  const saveToastChannel = useMemo(() => createSaveToastChannel(), []);
  const { flashSaved, flashSaveError } = saveToastChannel;
  const [name, setName] = useState(programName);
  const [lastSavedName, setLastSavedName] = useState(programName);
  const [days, setDays] = useState<BuilderDay[]>(initialDays);
  const [startDate, setStartDate] = useState(initialStartDate);
  const [trainingDays, setTrainingDays] = useState(initialTrainingDays);
  const [trainingIntent, setTrainingIntent] = useState(initialTrainingIntent);
  const restSuggestions = trainingIntent ? REST_TEMPO_SUGGESTIONS[trainingIntent] : undefined;
  // Guards handleAddWeek against a real race: it computes the next week
  // number off the `days` closure, stale until this component re-renders
  // with the new array. A fast double-click on "+ Add Week" would
  // otherwise insert two weeks with the same week_number (found and fixed
  // for the analogous per-set bug tonight).
  const [addWeekBusy, setAddWeekBusy] = useState(false);

  const scheduledDateByDayId = useMemo(() => {
    if (!startDate || !trainingDays || trainingDays.length === 0) return new Map<string, Date>();
    const ordered = days
      .slice()
      .sort((a, b) => a.weekNumber - b.weekNumber || a.dayIndex - b.dayIndex);
    return computeScheduledDates(
      startDate,
      trainingDays,
      ordered.map((d) => ({ id: d.id, scheduledDate: d.scheduledDate }))
    );
  }, [days, startDate, trainingDays]);

  const [expandedWeeks, setExpandedWeeks] = useState<Set<number>>(() => {
    const weekNumbers = initialDays.map((d) => d.weekNumber);
    if (initialExpandedWeek != null && weekNumbers.includes(initialExpandedWeek)) {
      return new Set([initialExpandedWeek]);
    }
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
    if (addWeekBusy) return;
    setAddWeekBusy(true);
    try {
      const weekNumbers = Array.from(new Set(days.map((d) => d.weekNumber)));
      const nextWeek = weekNumbers.length > 0 ? Math.max(...weekNumbers) + 1 : 1;

      const supabase = createBrowserClient();
      const { data: newRow, error: insertError } = await supabase
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

      if (insertError || !newRow) {
        flashSaveError("Couldn't add that week — try again.");
        return;
      }

      setDays((prev) => [
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
      setExpandedWeeks((prev) => new Set(prev).add(nextWeek));
      flashSaved();
    } finally {
      setAddWeekBusy(false);
    }
  }

  const weekNumbers = Array.from(new Set(days.map((d) => d.weekNumber))).sort((a, b) => a - b);
  const nextWeekNumber = weekNumbers.length > 0 ? Math.max(...weekNumbers) + 1 : 1;

  async function handleNameBlur() {
    const trimmed = name.trim();
    if (!trimmed) {
      setName(lastSavedName);
      return;
    }
    if (trimmed === lastSavedName) return;
    const supabase = createBrowserClient();
    const { error } = await supabase.from("programs").update({ name: trimmed }).eq("id", programId);
    if (error) {
      flashSaveError("Couldn't rename this program — try again.");
      setName(lastSavedName);
    } else {
      setLastSavedName(trimmed);
      setName(trimmed);
      flashSaved();
    }
  }

  return (
    <SaveToastChannelContext.Provider value={saveToastChannel}>
    <div>
      <SaveToast />
      <div className="pb-6 border-b border-steel/20 mb-6">
        <div className="flex items-start justify-between gap-3">
          <input
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            onBlur={handleNameBlur}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                e.currentTarget.blur();
              }
            }}
            aria-label="Program name"
            className="flex-1 bg-transparent border-none focus:outline-none focus:ring-1 focus:ring-rust font-display font-bold text-3xl uppercase leading-none text-chalk"
          />
          <ProgramCardMenu
            programId={programId}
            programName={name}
            groupId={groupId}
            hideAssignAndDuplicate={embedded}
          />
        </div>
        <ProgramAssignedClients programId={programId} groupId={groupId} athleteId={athleteId} />
        <div className="mt-2">
          <SaveStatusBar />
        </div>
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
          <a
            href={`/print/programs/${programId}`}
            target="_blank"
            rel="noopener"
            className="inline-flex items-center h-9 font-body text-xs text-rust border border-rust px-3"
          >
            Print or PDF
          </a>
          {startDate && trainingDays && trainingDays.length > 0 && (
            <Link
              href={`/groups/${groupId}/programs/${programId}/calendar`}
              className="inline-flex items-center h-9 font-body text-xs text-rust border border-rust px-3"
            >
              View as calendar &rarr;
            </Link>
          )}
        </div>
        <div className="flex flex-wrap gap-4 mt-4">
          <TrainingIntentSelector
            programId={programId}
            initialIntent={trainingIntent}
            onChange={setTrainingIntent}
          />
        </div>
      </div>

      {aiSequencingNotes && (
        <div className="mb-6">
          <ProgramChatPanel programId={programId} groupId={groupId} programName={name} />
        </div>
      )}

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
            athleteId={athleteId}
            exerciseLibrary={exerciseLibrary}
            exerciseAliases={exerciseAliases}
            exerciseTierByName={exerciseTierByName}
            demoLibrary={demoLibrary}
            movementPatterns={movementPatterns}
            laddersByPattern={laddersByPattern}
            restSuggestions={restSuggestions}
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
          disabled={addWeekBusy}
          className="w-full h-11 border border-steel/30 text-steel font-body text-sm active:border-rust active:text-rust transition-colors disabled:opacity-40"
        >
          + Add Week {nextWeekNumber}
        </button>
      </div>
    </div>
    </SaveToastChannelContext.Provider>
  );
}
