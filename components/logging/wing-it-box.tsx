"use client";

import { useRef, useState } from "react";
import { createBrowserClient } from "@/lib/supabase/client";
import type { SessionExerciseEntry } from "@/lib/types";
import { parseWingItLine, splitWingItText, type WingItLine } from "@/lib/quick-entry";
import { resolveQuickAddExerciseName } from "@/lib/quick-add-name";
import { exerciseNameProblem } from "@/lib/exercise-name-guard";
import { addSessionExercises, failedLine, type ExerciseDraft } from "@/lib/add-session-exercises";
import { useLiftUnit } from "./lift-unit-context";

// The wing-it logger (Ron, Oct 20: "select the client and then just do the live exercise parser ... you could input the reps as you're going ... And then in retrospect, it would show the
// full workout"). One box at the top of a coach-logged workout with no program: type (or say, with the keyboard's mic) "squat 3x5 225, bench 3x8 155", Add, and each line becomes an
// exercise card right away (the cards are the confirmation: edit or delete them there). A name that could be more than one library exercise asks which (up to 3, or keep it as typed).
// A line it can't read goes to the AI, and what the AI understood is shown first: nothing it heard is added before the coach says yes.

interface AiExercise {
  exerciseName: string;
  sets: number;
  reps: number | null;
  weight: number | null;
  rpe: number | null;
}

// A first rep number from what was typed ("8-12" -> 8), or null.
const firstReps = (r: string | null): number | null => {
  if (!r) return null;
  const n = parseInt(r, 10);
  return Number.isFinite(n) ? n : null;
};

export function WingItBox({
  sessionId,
  nextOrder,
  library,
  onAdded,
}: {
  sessionId: string;
  // The next free exercise order in the workout.
  nextOrder: number;
  // The coach's exercise library names.
  library: string[];
  onAdded: (entries: SessionExerciseEntry[]) => void;
}) {
  const unit = useLiftUnit();
  const inputRef = useRef<HTMLInputElement>(null);
  const usedOrder = useRef(0);
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  // Lines whose name could be more than one exercise: pick one, or keep it as typed.
  const [choices, setChoices] = useState<{ key: number; line: WingItLine; options: string[] }[]>([]);
  // What the AI understood from the lines that could not be read, waiting for a yes.
  const [aiDraft, setAiDraft] = useState<AiExercise[] | null>(null);

  const draftOf = (line: WingItLine, name: string): ExerciseDraft => ({
    exerciseName: name,
    sets: line.sets,
    reps: firstReps(line.reps),
    timeSeconds: line.timeSeconds,
    weight: line.weight,
    // A unit said on the line wins; otherwise the client's own unit.
    weightUnit: line.weightUnit ?? unit,
    rpe: line.rpe,
  });

  async function insert(drafts: ExerciseDraft[]) {
    if (drafts.length === 0) return true;
    const start = Math.max(nextOrder, usedOrder.current);
    usedOrder.current = start + drafts.length;
    const { entries, failed } = await addSessionExercises(createBrowserClient(), sessionId, start, drafts);
    onAdded(entries);
    if (entries[0]) {
      const id = entries[0].id;
      requestAnimationFrame(() => document.querySelector(`[data-exercise-id="${id}"]`)?.scrollIntoView({ behavior: "smooth", inline: "center", block: "center" }));
    }
    if (failed > 0) {
      setProblem(failedLine(failed, drafts.length));
      return false;
    }
    return true;
  }

  async function submit() {
    const lines = splitWingItText(text);
    if (lines.length === 0 || busy) return;
    setBusy(true);
    setProblem(null);
    try {
      const ready: ExerciseDraft[] = [];
      const ask: { key: number; line: WingItLine; options: string[] }[] = [];
      const unread: string[] = [];
      for (const raw of lines) {
        const line = parseWingItLine(raw);
        if (!line) {
          unread.push(raw);
          continue;
        }
        const resolved = resolveQuickAddExerciseName(line.exerciseName, library);
        if ("ambiguous" in resolved) {
          ask.push({ key: Date.now() + ask.length, line, options: resolved.ambiguous });
          continue;
        }
        if (exerciseNameProblem(resolved.name)) {
          unread.push(raw);
          continue;
        }
        ready.push(draftOf(line, resolved.name));
      }
      // The box is cleared and keeps focus: the next line can be typed (or said) straight away.
      setText("");
      inputRef.current?.focus();
      if (ask.length > 0) setChoices((prev) => [...prev, ...ask]);
      await insert(ready);
      if (unread.length > 0) {
        const res = await fetch("/api/ai/parse-session-nl", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ text: unread.join(", ") }) });
        const data = await res.json().catch(() => ({}));
        if (!res.ok || !Array.isArray(data.exercises) || data.exercises.length === 0) {
          setProblem(`I couldn't read "${unread.join(", ")}". Try it like "squat 3x5 225".`);
          setText(unread.join(", "));
        } else {
          setAiDraft(data.exercises as AiExercise[]);
        }
      }
    } catch {
      setProblem("That didn't go through. Check your signal and try again.");
    } finally {
      setBusy(false);
    }
  }

  async function pick(key: number, name: string) {
    const c = choices.find((x) => x.key === key);
    if (!c || busy) return;
    setBusy(true);
    setChoices((prev) => prev.filter((x) => x.key !== key));
    try {
      await insert([draftOf(c.line, name)]);
    } finally {
      setBusy(false);
    }
  }

  async function confirmAi() {
    if (!aiDraft || busy) return;
    const bad = aiDraft.find((ex) => exerciseNameProblem(ex.exerciseName));
    if (bad) {
      setProblem(exerciseNameProblem(bad.exerciseName));
      return;
    }
    setBusy(true);
    try {
      const drafts = aiDraft.map((ex) => {
        const resolved = resolveQuickAddExerciseName(ex.exerciseName, library);
        return { exerciseName: "name" in resolved ? resolved.name : ex.exerciseName, sets: ex.sets, reps: ex.reps, weight: ex.weight, weightUnit: unit, rpe: ex.rpe };
      });
      // Whatever did not save is said under the box; the list itself is done with either way (the cards show what was added).
      await insert(drafts);
      setAiDraft(null);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="mb-2 space-y-2" data-testid="wing-it-box">
      <form
        onSubmit={(e) => {
          e.preventDefault();
          submit();
        }}
        className="flex items-center gap-2"
      >
        <input
          ref={inputRef}
          type="text"
          value={text}
          onChange={(e) => setText(e.target.value)}
          enterKeyHint="done"
          autoComplete="off"
          placeholder="squat 3x5 225, bench 3x8 155"
          aria-label="What are they doing? One exercise per line or comma"
          className="flex-1 min-w-0 min-h-11 bg-surface border border-steel/30 text-chalk px-3 font-body text-sm focus:outline-none focus:border-rust"
        />
        <button type="submit" disabled={busy || !text.trim()} className="min-h-11 px-4 bg-rust text-graphite font-body text-sm font-medium disabled:opacity-40">
          {busy ? "Adding…" : "Add"}
        </button>
      </form>

      {choices.map((c) => (
        <div key={c.key} className="border border-steel/30 p-2" role="group" aria-label={`Which exercise is ${c.line.exerciseName}?`}>
          <p className="font-body text-xs text-steel mb-1.5">&quot;{c.line.exerciseName}&quot; could be:</p>
          <div className="flex flex-wrap gap-1.5">
            {c.options.map((o) => (
              <button key={o} type="button" onClick={() => pick(c.key, o)} disabled={busy} className="min-h-11 px-3 border border-steel/30 text-chalk font-body text-xs active:border-rust active:text-rust disabled:opacity-40">
                {o}
              </button>
            ))}
            <button type="button" onClick={() => pick(c.key, c.line.exerciseName)} disabled={busy} className="min-h-11 px-3 font-body text-xs text-steel disabled:opacity-40">
              Keep as typed
            </button>
          </div>
        </div>
      ))}

      {aiDraft && (
        <div className="border border-rust/40 bg-rust/5 p-3 space-y-1.5" data-testid="wing-it-ai">
          <p className="font-body text-xs text-steel uppercase tracking-wide">Add these?</p>
          {aiDraft.map((ex, i) => (
            <p key={i} className="font-body text-sm text-chalk">
              {ex.exerciseName}: {ex.sets} × {ex.reps ?? "?"}
              {ex.weight != null ? ` @ ${ex.weight}` : ""}
              {ex.rpe != null ? ` (RPE ${ex.rpe})` : ""}
            </p>
          ))}
          <div className="flex items-center gap-2 pt-1">
            <button type="button" onClick={confirmAi} disabled={busy} className="min-h-11 px-4 bg-rust text-graphite font-body text-xs font-medium disabled:opacity-40">
              {busy ? "Adding…" : "Yes, add them"}
            </button>
            <button type="button" onClick={() => setAiDraft(null)} disabled={busy} className="min-h-11 px-2 font-body text-xs text-steel disabled:opacity-40">
              Not these
            </button>
          </div>
        </div>
      )}

      {problem && (
        <p className="font-body text-xs text-rust" role="alert">
          {problem}
        </p>
      )}
    </div>
  );
}
