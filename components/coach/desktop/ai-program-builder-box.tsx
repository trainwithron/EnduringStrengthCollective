"use client";

import { useRef, useState } from "react";
import { createBrowserClient } from "@/lib/supabase/client";
import { readAiJson } from "@/lib/ai-fetch";
import { BUILDER_ONE_WORKOUT_SELECT, mapWorkoutRowToBuilderDay } from "@/lib/program-builder-data";
import { fixTargetFrom, parseBuildRequest, planSlots } from "@/lib/ai-day-request";
import type { DaySlot } from "@/lib/ai-day-slots";
import type { BuilderDay } from "@/lib/types";
import type { DemoRow } from "@/lib/exercise-demo";

type Phase = "idle" | "building" | "paused" | "done";

const COULDNT = "Couldn't build that day. Try Resume, or tell it what to change.";

// The AI Program Builder, at the top of the builder: it builds ONE day at a time and each finished day appears in the builder in its week and day. Pause keeps everything already built; while
// paused the coach types a correction and Resume fixes the day they point at (the last one built unless they name another) and carries on. Each new day knows the days already built and every
// correction so far. It only fills EMPTY days; it never wipes a day the coach built.
export function AiProgramBuilderBox({
  programId,
  days,
  trainingDaysCount,
  demoLibrary,
  exerciseTierByName,
  onDay,
}: {
  programId: string;
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

  async function callDay(mode: "build" | "fix", slot: DaySlot): Promise<{ ok: true; workoutId: string; flags: string[] } | { ok: false; message: string }> {
    try {
      const res = await fetch("/api/ai/build-day", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ programId, week: slot.week, day: slot.day, mode, instruction: request.current, corrections: corrections.current, runToken: token.current ?? undefined }),
      });
      const data = await readAiJson(res);
      if (!res.ok || !data.workoutId) return { ok: false, message: (data.error as string | undefined) ?? COULDNT };
      if (typeof data.runToken === "string") token.current = data.runToken;
      return { ok: true, workoutId: data.workoutId as string, flags: Array.isArray(data.flags) ? (data.flags as string[]) : [] };
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
      lastBuilt.current = slot;
      queue.current.shift();
    }
    setPhase("done");
    setLine("Done. Your days are in the builder.");
  }

  function ask() {
    const said = text.trim();
    if (!said || phase === "building") return;
    request.current = said;
    corrections.current = [];
    token.current = null;
    pauseRequested.current = false;
    setFlags([]);
    const existing = daysRef.current.map((d) => ({ week: d.weekNumber, day: d.dayIndex, hasExercises: d.items.some((i) => i.kind === "exercise") }));
    const slots = planSlots(existing, parseBuildRequest(said), trainingDaysCount);
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
    const said = text.trim();
    pauseRequested.current = false;
    setError(null);
    setPhase("building");
    if (said) {
      corrections.current = [...corrections.current, said];
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
      }
    }
    void runQueue();
  }

  const building = phase === "building";
  return (
    <section className="mt-4 border border-steel/25 bg-surface/40 p-3 max-w-3xl" aria-label="AI Program Builder">
      <h2 className="font-display uppercase text-sm tracking-wide text-steel">AI Program Builder</h2>
      <p className="font-body text-xs text-steel mt-1">Saved as you go. Nothing reaches the client until you assign it.</p>
      <div className="mt-2 flex flex-col sm:flex-row gap-2">
        <textarea
          value={text}
          onChange={(e) => setText(e.target.value)}
          rows={2}
          placeholder={phase === "paused" ? "What should it change?" : "Tell it what to build, or say: finish the week using Day 1"}
          aria-label="Tell the AI what to build"
          className="flex-1 min-w-0 bg-graphite border border-steel/30 text-chalk px-2 py-2 font-body text-base sm:text-sm focus:outline-none focus:border-rust"
        />
        {building ? (
          <button type="button" onClick={pause} className="min-h-11 px-5 border border-rust text-rust font-display font-bold uppercase tracking-wide sm:self-start">
            Pause
          </button>
        ) : phase === "paused" ? (
          <button type="button" onClick={() => void resume()} className="min-h-11 px-5 bg-rust text-graphite font-display font-bold uppercase tracking-wide sm:self-start">
            Resume
          </button>
        ) : (
          <button type="button" onClick={ask} disabled={!text.trim()} className="min-h-11 px-5 bg-rust text-graphite font-display font-bold uppercase tracking-wide disabled:opacity-40 sm:self-start">
            Ask
          </button>
        )}
      </div>
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
      {flags.length > 0 && (
        <p className="font-body text-xs text-steel mt-1">Worth a look: {flags.slice(-3).join(" · ")}</p>
      )}
    </section>
  );
}
