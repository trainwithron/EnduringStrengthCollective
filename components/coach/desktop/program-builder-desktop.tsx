"use client";

import type { DemoRow } from "@/lib/exercise-demo";
import { insertProgramDay } from "@/lib/program-days";
import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ProgramAssignPanel } from "@/components/coach/desktop/program-assign-panel";
import { createBrowserClient } from "@/lib/supabase/client";
import type { BuilderDay } from "@/lib/types";
import { isRestDayTitle } from "@/lib/empty-sweep";
import type { AliasEntry } from "@/lib/exercise-matching";
import { WeekGrid } from "./week-grid";
import { ProgramScheduleSettings } from "../program-schedule-settings";
import { computeScheduledDates, type VisibilityWindow } from "@/lib/program-schedule";
import type { MovementPatternOption } from "../exercise-builder-card";
import { ProgramAssignedClients } from "@/components/coach/desktop/program-assigned-clients";
import { ProgramCardMenu } from "./program-card-menu";
import { SaveToast } from "./save-toast";
import { UndoToast } from "./undo-toast";
import { confirmDialog } from "@/components/shared/confirm-dialog";
import { SaveStatusBar } from "./save-status-bar";
import { ProgramProgressionPanel } from "./program-progression-panel";
import type { Rule } from "@/lib/program-progression";
import { SaveToastChannelContext } from "./save-toast-channel";
import { createSaveToastChannel } from "@/lib/save-toast";
import { ProgramChatPanel } from "./program-chat-panel";
import { TrainingIntentSelector } from "../training-intent-selector";
import { AiProgramBuilderBox } from "./ai-program-builder-box";
import { REST_TEMPO_SUGGESTIONS, type TrainingIntent } from "@/lib/training-intent";
import { ProgramDescriptionEditor } from "@/components/coach/program-description-editor";

export function ProgramBuilderDesktop({
  programId,
  groupId,
  athleteId,
  canAddSlot = false,
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
  initialProgressions = [],
  initialExpandedWeek = null,
  embedded = false,
  toolbarExtra,
  aiDraft = false,
  orgProgram = false,
}: {
  programId: string;
  groupId: string;
  // disconnected_sibling_tools_ux_audit_sept30.md — null for a shared
  // group program (no single athlete to resolve a training max
  // against); set for a personal per-client copy. Threaded down to
  // WeekGrid/DuplicateWeekPanel so "% of training max" can query a real
  // athlete_training_maxes row instead of having no athlete context.
  athleteId: string | null;
  canAddSlot?: boolean;
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
  // The program's progression rules (exercise_progressions) as saved, for the Progression choice in the toolbar.
  initialProgressions?: Rule[];
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
  // Extra controls for the button row under the name (the program page puts the label and order box here). Not given in the embedded copy.
  toolbarExtra?: React.ReactNode;
  // The program is an unsigned AI draft: assigning it from here signs it off first, as the program cards do.
  aiDraft?: boolean;
  // An organization program: Assign lists the organization's clients and its groups (lib/org-programs.ts).
  orgProgram?: boolean;
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
  const router = useRouter();
  // "Assign to clients": the one existing assign panel (with its sign-off of an AI draft, its double-click guard and its same-organization rule) opened on this program.
  const [assignOpen, setAssignOpen] = useState(false);
  const [name, setName] = useState(programName);
  const [lastSavedName, setLastSavedName] = useState(programName);
  const [days, setDays] = useState<BuilderDay[]>(initialDays);
  // Something typed that has not been saved yet (every field saves when the coach leaves it): closing or reloading the tab then asks first. "Saved" clears it.
  const rootRef = useRef<HTMLDivElement>(null);
  const unsavedRef = useRef(false);
  useEffect(() => {
    const root = rootRef.current;
    const onInput = () => {
      unsavedRef.current = true;
    };
    root?.addEventListener("input", onInput);
    const unsubscribe = saveToastChannel.subscribeSaveToast((event) => {
      if (event.kind === "saved") unsavedRef.current = false;
    });
    const onBeforeUnload = (e: BeforeUnloadEvent) => {
      if (!unsavedRef.current) return;
      e.preventDefault();
      e.returnValue = "";
    };
    // Coming back to the page from the browser's own history (a restored copy) always shows what is saved.
    const onPageShow = (e: PageTransitionEvent) => {
      if (e.persisted) router.refresh();
    };
    window.addEventListener("beforeunload", onBeforeUnload);
    window.addEventListener("pageshow", onPageShow);
    return () => {
      root?.removeEventListener("input", onInput);
      unsubscribe();
      window.removeEventListener("beforeunload", onBeforeUnload);
      window.removeEventListener("pageshow", onPageShow);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  // Empty days are never removed behind the coach's back; a button below offers to remove them (see removeEmptyDays).
  const emptyDayIds = days.filter((d) => d.items.length === 0 && !isRestDayTitle(d.title)).map((d) => d.id);
  const [sweepBusy, setSweepBusy] = useState(false);
  async function removeEmptyDays() {
    if (sweepBusy || emptyDayIds.length === 0) return;
    const n = emptyDayIds.length;
    if (!(await confirmDialog({ message: `Remove ${n} empty ${n === 1 ? "day" : "days"}? They have no exercises, notes or logged work.`, confirmLabel: "Remove" }))) return;
    setSweepBusy(true);
    try {
      const res = await fetch("/api/programs/sweep-empty-days", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ programId, dayIds: emptyDayIds, explicit: true }) });
      if (!res.ok) {
        flashSaveError("Couldn't remove the empty days — try again.");
        return;
      }
      const out = (await res.json()) as { removed?: string[] };
      const gone = new Set(out.removed ?? []);
      if (gone.size > 0) setDays((prev) => prev.filter((d) => !gone.has(d.id)));
      flashSaved();
    } catch {
      flashSaveError("Couldn't remove the empty days — try again.");
    } finally {
      setSweepBusy(false);
    }
  }
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

  // A day the AI Program Builder has just written (or fixed): drawn in its week and day, replacing the same day if it was already on screen.
  function handleAiDay(day: BuilderDay) {
    setDays((prev) => (prev.some((d) => d.id === day.id) ? prev.map((d) => (d.id === day.id ? day : d)) : [...prev, day]));
    setExpandedWeeks((prev) => new Set(prev).add(day.weekNumber));
  }

  async function handleAddWeek() {
    if (addWeekBusy) return;
    setAddWeekBusy(true);
    try {
      const weekNumbers = Array.from(new Set(days.map((d) => d.weekNumber)));
      const nextWeek = weekNumbers.length > 0 ? Math.max(...weekNumbers) + 1 : 1;

      const supabase = createBrowserClient();
      const { row: newRow, error: insertError } = await insertProgramDay(supabase, { programId, groupId, weekNumber: "next", title: () => "Day 1" });

      if (insertError || !newRow) {
        flashSaveError(insertError ?? "Couldn't add that week — try again.");
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
    <div ref={rootRef}>
      <SaveToast />
      <UndoToast />
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
            aiDraft={aiDraft}
            hideAssignAndDuplicate={embedded}
            slotCount={days.reduce((n, d) => n + d.items.filter((i) => i.kind === "exercise" && !!i.slot).length, 0)}
          />
        </div>
        <ProgramAssignedClients programId={programId} groupId={groupId} athleteId={athleteId} />
        <div className="mt-2">
          <SaveStatusBar />
        </div>
        <ProgramDescriptionEditor programId={programId} initialDescription={programDescription} />
        <ProgramProgressionPanel programId={programId} groupId={groupId} days={days} initialRules={initialProgressions} onDaysChange={setDays} />
        <div className="flex flex-wrap gap-3 mt-4">
          <a
            href={`/print/programs/${programId}`}
            target="_blank"
            rel="noopener"
            className="inline-flex items-center h-9 font-body text-xs text-rust border border-rust px-3"
          >
            Print or PDF
          </a>
          <button
            type="button"
            onClick={() => setAssignOpen(true)}
            className="inline-flex items-center h-11 sm:h-9 font-body text-xs text-rust border border-rust px-3"
          >
            Assign to clients
          </button>
          {toolbarExtra}
          {startDate && trainingDays && trainingDays.length > 0 && (
            <Link
              href={`/groups/${groupId}/programs/${programId}/calendar`}
              className="inline-flex items-center h-9 font-body text-xs text-rust border border-rust px-3"
            >
              View as calendar &rarr;
            </Link>
          )}
        </div>
        {assignOpen && (
          <ProgramAssignPanel programId={programId} programName={name} groupId={groupId} aiDraft={aiDraft} orgProgram={orgProgram} onClose={() => setAssignOpen(false)} onChanged={() => router.refresh()} />
        )}
        {!embedded && (
          <AiProgramBuilderBox
            programId={programId}
            groupId={groupId}
            athleteId={athleteId}
            days={days}
            trainingDaysCount={trainingDays && trainingDays.length > 0 ? trainingDays.length : null}
            demoLibrary={demoLibrary}
            exerciseTierByName={exerciseTierByName}
            onDay={handleAiDay}
            orgProgram={orgProgram}
          />
        )}
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
            canAddSlot={canAddSlot}
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
            onDaysChange={(change) =>
              setDays((prev) => {
                const week = prev.filter((d) => d.weekNumber === wn);
                const weekDays = typeof change === "function" ? change(week) : change;
                return [...prev.filter((d) => d.weekNumber !== wn), ...weekDays];
              })
            }
            onWeeksGenerated={(newDays) => {
              setDays((prev) => [...prev, ...newDays]);
              setExpandedWeeks((prev) => {
                const next = new Set(prev);
                newDays.forEach((d) => next.add(d.weekNumber));
                return next;
              });
            }}
            onWeekRestored={(back) => {
              setDays((prev) => [...prev.filter((d) => !back.some((b) => b.id === d.id)), ...back]);
              setExpandedWeeks((prev) => new Set(prev).add(wn));
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

      {emptyDayIds.length > 0 && (
        <div className="pt-4">
          <button
            type="button"
            onClick={removeEmptyDays}
            disabled={sweepBusy}
            className="w-full min-h-11 border border-steel/30 text-steel font-body text-sm active:border-rust active:text-rust transition-colors disabled:opacity-40"
          >
            {sweepBusy ? "Removing…" : `Remove ${emptyDayIds.length} empty ${emptyDayIds.length === 1 ? "day" : "days"}`}
          </button>
        </div>
      )}
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
