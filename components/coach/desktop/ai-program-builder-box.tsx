"use client";

import { useRef, useState } from "react";
import { createBrowserClient } from "@/lib/supabase/client";
import { readAiJson } from "@/lib/ai-fetch";
import { BUILDER_ONE_WORKOUT_SELECT, mapWorkoutRowToBuilderDay } from "@/lib/program-builder-data";
import { AiRunPanel } from "@/components/coach/desktop/ai-run-panel";
import { MicButton } from "@/components/shared/mic-button";
import { ProgramImportLauncher, ProgramImportPanel } from "@/components/coach/desktop/program-import-launcher";
import { detectImportKind } from "@/lib/import-input-kind";
import { TemplateSuggestion } from "@/components/coach/desktop/template-suggestion";
import { LearnLine } from "@/components/coach/desktop/learn-line";
import { appliedLine, type AppliedRule } from "@/lib/learned-for-prompt";
import { LikeClientSuggestion } from "@/components/coach/desktop/like-client";
import { PastAiNotes } from "@/components/coach/desktop/past-ai-notes";
import { fixTargetFrom, parseBuildRequest, planSlots, scopeLimitFrom } from "@/lib/ai-day-request";
import { WHICH_WEEKS_QUESTION, isEditRequest, isYes, parseWeekRange, type PlannedDay, type WeekRange } from "@/lib/ai-week-edit";
import type { DaySlot } from "@/lib/ai-day-slots";
import type { BuilderDay } from "@/lib/types";
import type { DemoRow } from "@/lib/exercise-demo";

type Phase = "idle" | "building" | "paused" | "done";

const COULDNT = "Couldn't build that day. Try Resume, or tell it what to change.";

// The AI Program Builder, at the top of the builder: it builds ONE day at a time and each finished day appears in the builder in its week and day. Pause keeps everything already built; while
// paused the coach types a correction and Resume fixes the day they point at (the last one built unless they name another) and carries on. Each new day knows the days already built and every
// correction so far. It only fills EMPTY days; it never wipes a day the coach built. Asked to CHANGE days already built ("drop the squats to 8 reps from week 2 on"), it shows every change first and
// writes them only on Apply (lib/ai-week-edit.ts).
export function AiProgramBuilderBox({
  programId,
  groupId,
  athleteId = null,
  days,
  trainingDaysCount,
  demoLibrary,
  exerciseTierByName,
  onDay,
  orgProgram = false,
}: {
  // The program being built is an organization program: a program imported from here is one too.
  orgProgram?: boolean;
  programId: string;
  groupId: string;
  // The client this program is for, when it is a personal copy (the rules the AI learns are matched to what is known about the client).
  athleteId?: string | null;
  days: BuilderDay[];
  trainingDaysCount: number | null;
  demoLibrary: DemoRow[];
  exerciseTierByName: Record<string, "A" | "B" | "C" | null>;
  onDay: (day: BuilderDay) => void;
}) {
  const [text, setText] = useState("");
  const [phase, setPhase] = useState<Phase>("idle");
  const [line, setLine] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [flags, setFlags] = useState<string[]>([]);
  // A correction typed while paused: after it is applied the app offers, once, to remember it ("I'll remember: ...").
  const [learn, setLearn] = useState<{ id: number; correction: string } | null>(null);
  // The rules the AI used for the days it built, each with its reason and an Undo.
  const [applied, setApplied] = useState<AppliedRule[]>([]);
  // "Like Rob": the client the AI should look at as a reference for this request; sent with every day, never stored.
  const referenceId = useRef<string | null>(null);
  // What the coach told the AI for this client is sent once, when the run is done, to be kept as a few short notes (nothing is shown or asked).
  const notesSent = useRef("");
  function rememberForClient() {
    if (!athleteId) return;
    const said = [request.current, ...corrections.current].join("|");
    if (!request.current.trim() || notesSent.current === said) return;
    notesSent.current = said;
    void fetch("/api/learning/notes", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ action: "learn", groupId, athleteId, text: request.current, corrections: corrections.current }) }).catch(() => {});
  }
  async function undoApplied(rule: AppliedRule) {
    const res = await fetch(`/api/learned-rules/${rule.id}`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ action: "undo" }) }).catch(() => null);
    if (res?.ok) setApplied((prev) => prev.filter((a) => a.id !== rule.id));
  }
  // What he asked for in this run, shown beside the box (read-only).
  const [shownRequest, setShownRequest] = useState("");
  const [shownCorrections, setShownCorrections] = useState<string[]>([]);
  // After a run finishes: the next week it can offer to continue into (one button, never started by itself).
  const [offerWeek, setOfferWeek] = useState<number | null>(null);
  const finishedWeeks = useRef<Set<number>>(new Set());
  const lastRequest = useRef<{ daysPerWeek: number | null }>({ daysPerWeek: null });
  const pauseRequested = useRef(false);
  // The run that is going: Pause shows "paused" at once, but the day already being built finishes (and is drawn) in the background, so Resume waits for it before carrying on.
  const runPromise = useRef<Promise<void> | null>(null);
  const resuming = useRef(false);
  const queue = useRef<DaySlot[]>([]);
  const token = useRef<string | null>(null);
  const request = useRef("");
  const corrections = useRef<string[]>([]);
  const lastBuilt = useRef<DaySlot | null>(null);
  const daysRef = useRef(days);
  daysRef.current = days;

  async function callDay(mode: "build" | "fix", slot: DaySlot): Promise<{ ok: true; workoutId: string; flags: string[]; applied: AppliedRule[] } | { ok: false; message: string }> {
    try {
      const res = await fetch("/api/ai/build-day", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ programId, week: slot.week, day: slot.day, mode, instruction: request.current, corrections: corrections.current, runToken: token.current ?? undefined, referenceClientId: referenceId.current }),
      });
      const data = await readAiJson(res);
      if (!res.ok || !data.workoutId) return { ok: false, message: (data.error as string | undefined) ?? COULDNT };
      if (typeof data.runToken === "string") token.current = data.runToken;
      return { ok: true, workoutId: data.workoutId as string, flags: Array.isArray(data.flags) ? (data.flags as string[]) : [], applied: Array.isArray(data.applied) ? (data.applied as AppliedRule[]) : [] };
    } catch {
      return { ok: false, message: COULDNT };
    }
  }

  // Draws the finished day in the builder.
  async function show(workoutId: string): Promise<boolean> {
    const { data } = await createBrowserClient().from("workouts").select(BUILDER_ONE_WORKOUT_SELECT).eq("id", workoutId).maybeSingle();
    if (!data) return false;
    onDay(mapWorkoutRowToBuilderDay(data, demoLibrary, new Map(Object.entries(exerciseTierByName))));
    return true;
  }

  function runQueue(): Promise<void> {
    const p = runQueueInner().finally(() => {
      if (runPromise.current === p) runPromise.current = null;
    });
    runPromise.current = p;
    return p;
  }

  async function runQueueInner() {
    setPhase("building");
    setError(null);
    while (queue.current.length > 0) {
      if (pauseRequested.current) {
        setPhase("paused");
        setLine("Paused. Tell it what to change, then Resume.");
        return;
      }
      const slot = queue.current[0];
      setLine(`Building Week ${slot.week}, Day ${slot.day}…`);
      const result = await callDay("build", slot);
      if (!result.ok) {
        setError(result.message);
        setPhase("paused");
        setLine("Paused. Tell it what to change, then Resume.");
        return;
      }
      await show(result.workoutId);
      if (result.flags.length > 0) setFlags((prev) => [...prev, ...result.flags].slice(-6));
      if (result.applied.length > 0) setApplied((prev) => [...prev.filter((a) => !result.applied.some((n) => n.id === a.id)), ...result.applied]);
      lastBuilt.current = slot;
      finishedWeeks.current.add(slot.week);
      queue.current.shift();
    }
    setPhase("done");
    rememberForClient();
    const weeks = [...finishedWeeks.current].sort((a, b) => a - b);
    const top = weeks.length > 0 ? weeks[weeks.length - 1] : (lastBuilt.current?.week ?? 1);
    setLine(weeks.length <= 1 ? `Done. Week ${top} is in the builder.` : "Done. Your days are in the builder.");
    setOfferWeek(top < 24 ? top + 1 : null);
  }

  // Pasted program text (several lines of sets and reps, day or week headers, a table) is not a request to build: the coach is asked first, and nothing is written to this program until they choose.
  const [programChoice, setProgramChoice] = useState<string | null>(null);
  const [importText, setImportText] = useState<string | null>(null);

  // Changing days that are already built (lib/ai-week-edit.ts): the coach's words and the weeks; a preview of every change; nothing is written until Apply.
  const [edit, setEdit] = useState<{ instruction: string; corrections: string[]; range: WeekRange | null } | null>(null);
  const [preview, setPreview] = useState<{ lines: string[]; skipped: string[]; flags: string[]; plan: PlannedDay[] } | null>(null);
  const [editBusy, setEditBusy] = useState<"preview" | "apply" | null>(null);

  async function runPreview(next: { instruction: string; corrections: string[]; range: WeekRange }) {
    setEdit(next);
    setPreview(null);
    setError(null);
    setEditBusy("preview");
    setLine("Working out the changes…");
    try {
      const res = await fetch("/api/ai/edit-weeks", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ mode: "preview", programId, instruction: next.instruction, corrections: next.corrections, range: next.range }) });
      const data = await readAiJson(res);
      if (!res.ok) {
        setLine(null);
        setError((data.error as string | undefined) ?? "Couldn't work out those changes. Try saying it another way.");
        return;
      }
      const lines = Array.isArray(data.lines) ? (data.lines as string[]) : [];
      const skipped = Array.isArray(data.skipped) ? (data.skipped as string[]) : [];
      if (lines.length === 0) {
        setLine([typeof data.question === "string" ? data.question : "Nothing to change.", ...skipped].join(" "));
        return;
      }
      setPreview({ lines, skipped, flags: Array.isArray(data.flags) ? (data.flags as string[]) : [], plan: Array.isArray(data.plan) ? (data.plan as PlannedDay[]) : [] });
      setLine("Here is what will change. Nothing is saved until you press Apply.");
    } catch {
      setLine(null);
      setError("Couldn't work out those changes. Try saying it another way.");
    } finally {
      setEditBusy(null);
    }
  }

  // Starts a change, or carries one on: the answer to "Which weeks?", or a correction to the preview (which is worked out again).
  function askEdit(said: string): boolean {
    // A correction to the preview, or the answer to a question it asked back: worked out again with everything said so far.
    if (edit?.range) {
      void runPreview({ ...edit, range: edit.range, corrections: [...edit.corrections, said] });
      return true;
    }
    if (edit && !edit.range) {
      const range = parseWeekRange(said) ?? (isYes(said) ? ({ kind: "weeks", from: 2, to: null } as const) : null);
      if (!range) {
        setLine(WHICH_WEEKS_QUESTION);
        return true;
      }
      void runPreview({ instruction: edit.instruction, corrections: isYes(said) ? edit.corrections : [...edit.corrections, said], range });
      return true;
    }
    const hasBuilt = daysRef.current.some((d) => d.items.some((i) => i.kind === "exercise"));
    if (!isEditRequest(said, hasBuilt)) return false;
    const range = parseWeekRange(said);
    if (!range) {
      setEdit({ instruction: said, corrections: [], range: null });
      setPreview(null);
      setError(null);
      setLine(WHICH_WEEKS_QUESTION);
      return true;
    }
    void runPreview({ instruction: said, corrections: [], range });
    return true;
  }

  function cancelEdit() {
    setEdit(null);
    setPreview(null);
    setLine("Cancelled. Nothing was changed.");
  }

  async function applyEdit() {
    if (!preview || editBusy) return;
    setEditBusy("apply");
    setError(null);
    try {
      const res = await fetch("/api/ai/edit-weeks", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ mode: "apply", programId, plan: preview.plan }) });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError((data.error as string | undefined) ?? "Couldn't save those changes, so nothing was changed. Try Apply again.");
        return;
      }
      const changed = Array.isArray(data.changedWorkoutIds) ? (data.changedWorkoutIds as string[]) : [];
      for (const id of changed) await show(id);
      const skipped = Array.isArray(data.skipped) ? (data.skipped as string[]) : [];
      setEdit(null);
      setPreview(null);
      setLine([`Done. ${changed.length} ${changed.length === 1 ? "day" : "days"} changed.`, ...skipped].join(" "));
    } catch {
      setError("Couldn't save those changes, so nothing was changed. Try Apply again.");
    } finally {
      setEditBusy(null);
    }
  }

  function ask(skipProgramCheck = false) {
    const said = text.trim();
    if (!said || phase === "building" || editBusy) return;
    if (!skipProgramCheck && phase !== "paused" && detectImportKind({ text: said }).kind === "pasted_program") {
      setProgramChoice(said);
      return;
    }
    setProgramChoice(null);
    if (phase !== "paused" && askEdit(said)) {
      setText("");
      return;
    }
    request.current = said;
    corrections.current = [];
    setShownRequest(said);
    setShownCorrections([]);
    token.current = null;
    pauseRequested.current = false;
    setFlags([]);
    setOfferWeek(null);
    finishedWeeks.current = new Set();
    const existing = daysRef.current.map((d) => ({ week: d.weekNumber, day: d.dayIndex, hasExercises: d.items.some((i) => i.kind === "exercise") }));
    const parsed = parseBuildRequest(said);
    lastRequest.current = { daysPerWeek: parsed.daysPerWeek };
    const slots = planSlots(existing, parsed, trainingDaysCount);
    if (slots.length === 0) {
      setPhase("idle");
      setLine("Every day in that range already has exercises. Say how many weeks to add, for example: make it 4 weeks.");
      return;
    }
    queue.current = slots;
    lastBuilt.current = null;
    setText("");
    void runQueue();
  }

  function pause() {
    pauseRequested.current = true;
    setPhase("paused");
    setLine("Paused. Tell it what to change, then Resume.");
  }

  async function resume() {
    if (phase === "building" || resuming.current) return;
    resuming.current = true;
    try {
      // The day that was being built when Pause was pressed lands first.
      if (runPromise.current) {
        setLine("Finishing the day it was on…");
        await runPromise.current;
      }
      await resumeNow();
    } finally {
      resuming.current = false;
    }
  }

  async function resumeNow() {
    let said = text.trim();
    // "only one week" / "just week one": stop after that many weeks; the rest of the queue is dropped, and the words are not treated as a change to a day.
    const scope = scopeLimitFrom(said);
    if (scope) {
      queue.current = queue.current.filter((s) => s.week <= scope.weeks);
      said = said.replace(new RegExp(scope.phrase.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "i"), "").replace(/^[\s,.;:-]+|[\s,.;:-]+$/g, "").trim();
      setText(said);
    }
    pauseRequested.current = false;
    setError(null);
    setPhase("building");
    if (said) {
      corrections.current = [...corrections.current, said];
      setShownCorrections([...corrections.current]);
      setLearn({ id: Date.now(), correction: said });
      setText("");
      const named = fixTargetFrom(said);
      const target: DaySlot | null = named ? { week: named.week ?? lastBuilt.current?.week ?? 1, day: named.day } : lastBuilt.current;
      const hasTarget = target && daysRef.current.some((d) => d.weekNumber === target.week && d.dayIndex === target.day && d.items.some((i) => i.kind === "exercise"));
      if (target && hasTarget) {
        setLine(`Changing Week ${target.week}, Day ${target.day}…`);
        const fixed = await callDay("fix", target);
        if (!fixed.ok) {
          setError(fixed.message);
          setPhase("paused");
          setLine("Paused. Tell it what to change, then Resume.");
          return;
        }
        await show(fixed.workoutId);
        if (fixed.flags.length > 0) setFlags((prev) => [...prev, ...fixed.flags].slice(-6));
        if (fixed.applied.length > 0) setApplied((prev) => [...prev.filter((a) => !fixed.applied.some((n) => n.id === a.id)), ...fixed.applied]);
      }
    }
    void runQueue();
  }

  // The one offered next week: its empty days only, as a new run. Never started by itself.
  function continueInto(week: number) {
    if (phase === "building") return;
    setOfferWeek(null);
    token.current = null;
    pauseRequested.current = false;
    finishedWeeks.current = new Set();
    const existing = daysRef.current.map((d) => ({ week: d.weekNumber, day: d.dayIndex, hasExercises: d.items.some((i) => i.kind === "exercise") }));
    const slots = planSlots(existing, { weeks: week, daysPerWeek: lastRequest.current.daysPerWeek, finishWeek: false }, trainingDaysCount).filter((s) => s.week === week);
    if (slots.length === 0) {
      setLine(`Week ${week} already has exercises.`);
      return;
    }
    queue.current = slots;
    void runQueue();
  }

  const building = phase === "building";
  return (
    <div className="mt-4 flex flex-col lg:flex-row lg:items-start gap-3">
    <section className="border border-steel/25 bg-surface/40 p-3 max-w-3xl w-full lg:flex-1 min-w-0" aria-label="AI Program Builder">
      <h2 className="font-display uppercase text-sm tracking-wide text-steel">AI Program Builder</h2>
      <p className="font-body text-xs text-steel mt-1">Saved as you go. Nothing reaches the client until you assign it.</p>
      <div className="mt-1">
        <ProgramImportLauncher groupId={groupId} athleteId={athleteId} orgProgram={orgProgram} programId={programId} />
      </div>
      <div className="mt-2 flex flex-col sm:flex-row gap-2">
        <textarea
          value={text}
          onChange={(e) => {
            setText(e.target.value);
            setProgramChoice(null);
          }}
          rows={2}
          placeholder={phase === "paused" ? "What should it change?" : preview ? "Type a correction to the changes" : "Tell it what to build, or say: finish the week using Day 1"}
          aria-label="Tell the AI what to build"
          className="flex-1 min-w-0 bg-graphite border border-steel/30 text-chalk px-2 py-2 font-body text-base sm:text-sm focus:outline-none focus:border-rust"
        />
        <div className="sm:self-start">
          <MicButton
            onText={(t) => setText((x) => (x.trim() ? `${x.trim()} ${t}` : t))}
            startLabel="Start voice typing"
            stopLabel="Stop voice typing"
            continuous
            unsupportedHint="Voice typing isn't available in this browser"
          />
        </div>
        {building ? (
          <button type="button" onClick={pause} className="min-h-11 px-5 border border-rust text-rust font-display font-bold uppercase tracking-wide sm:self-start">
            Pause
          </button>
        ) : phase === "paused" ? (
          <button type="button" onClick={() => void resume()} className="min-h-11 px-5 bg-rust text-graphite font-display font-bold uppercase tracking-wide sm:self-start">
            Resume
          </button>
        ) : (
          <button type="button" onClick={() => ask()} disabled={!text.trim() || editBusy !== null} className="min-h-11 px-5 bg-rust text-graphite font-display font-bold uppercase tracking-wide disabled:opacity-40 sm:self-start">
            Ask
          </button>
        )}
      </div>
      {programChoice !== null && (
        <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1" role="status">
          <p className="font-body text-sm text-chalk">This looks like a full program. Import it?</p>
          <button
            type="button"
            onClick={() => {
              setImportText(programChoice);
              setProgramChoice(null);
            }}
            className="min-h-11 px-4 bg-rust text-graphite font-body text-sm font-medium"
          >
            Import it
          </button>
          <button type="button" onClick={() => ask(true)} className="min-h-11 px-4 border border-steel/40 text-chalk font-body text-sm">
            Build from it
          </button>
        </div>
      )}
      {importText !== null && <ProgramImportPanel groupId={groupId} athleteId={athleteId} orgProgram={orgProgram} programId={programId} text={importText} onClose={() => setImportText(null)} />}
      {phase === "idle" && <TemplateSuggestion text={text} />}
      {(phase === "idle" || phase === "paused") && <LikeClientSuggestion text={text} groupId={groupId} athleteId={athleteId} onUse={(id) => { referenceId.current = id; }} />}
      {athleteId && <PastAiNotes athleteId={athleteId} groupId={groupId} />}
      {applied.length > 0 && (
        <ul className="mt-2 space-y-1" aria-label="Rules applied">
          {applied.map((a) => (
            <li key={a.id} className="flex items-start gap-2 font-body text-xs text-steel">
              <span className="flex-1 min-w-0">{appliedLine(a)}</span>
              <button type="button" onClick={() => void undoApplied(a)} className="min-h-11 px-2 underline shrink-0">
                Undo
              </button>
            </li>
          ))}
        </ul>
      )}
      {learn && <LearnLine key={learn.id} correction={learn.correction} programId={programId} groupId={groupId} athleteId={athleteId} />}
      {line && (
        <p className="font-body text-sm text-chalk mt-2" role="status">
          {line}
        </p>
      )}
      {error && (
        <p className="font-body text-xs text-rust mt-1" role="alert">
          {error}
        </p>
      )}
      {edit && !preview && editBusy === null && (
        <button type="button" onClick={cancelEdit} className="mt-1 min-h-11 font-body text-xs text-steel underline">
          Cancel this change
        </button>
      )}
      {preview && (
        <div className="mt-2 border border-steel/25 p-3" aria-label="Changes to apply" data-edit-preview>
          <ul className="space-y-1">
            {preview.lines.map((l) => (
              <li key={l} className="font-body text-sm text-chalk">
                {l}
              </li>
            ))}
          </ul>
          {preview.skipped.length > 0 && <p className="font-body text-xs text-steel mt-2">{preview.skipped.join(". ")}.</p>}
          {preview.flags.length > 0 && <p className="font-body text-xs text-steel mt-1">Worth a look: {preview.flags.join(" · ")}</p>}
          <div className="mt-3 flex flex-wrap items-center gap-3">
            <button type="button" onClick={() => void applyEdit()} disabled={editBusy !== null} className="min-h-11 px-5 bg-rust text-graphite font-display font-bold uppercase tracking-wide disabled:opacity-40">
              {editBusy === "apply" ? "Applying…" : "Apply"}
            </button>
            <button type="button" onClick={cancelEdit} disabled={editBusy !== null} className="min-h-11 px-4 border border-steel/40 text-chalk font-body text-sm disabled:opacity-40">
              Cancel
            </button>
            <p className="font-body text-xs text-steel">Or type a correction and press Ask to see it again.</p>
          </div>
        </div>
      )}
      {phase === "done" && offerWeek && (
        <div className="mt-2 flex flex-wrap items-center gap-3">
          <p className="font-body text-sm text-chalk">Want me to continue into Week {offerWeek}?</p>
          <button type="button" onClick={() => continueInto(offerWeek)} className="min-h-11 px-5 bg-rust text-graphite font-display font-bold uppercase tracking-wide">
            Continue into Week {offerWeek}
          </button>
        </div>
      )}
      {flags.length > 0 && (
        <p className="font-body text-xs text-steel mt-1">Worth a look: {flags.slice(-3).join(" · ")}</p>
      )}
    </section>
    <AiRunPanel programId={programId} request={shownRequest} corrections={shownCorrections} />
    </div>
  );
}
