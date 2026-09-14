"use client";

import { useState } from "react";
import { createBrowserClient } from "@/lib/supabase/client";
import type { SessionExerciseEntry } from "@/lib/types";

interface ParsedExercise {
  exerciseName: string;
  sets: number;
  reps: number | null;
  weight: number | null;
  rpe: number | null;
}

// The coach mobile app's "lightweight NL program builder"
// (coach_mobile_app_redesign_plan.md, locked 2026-09-14) — a faster,
// text-based alternative to "+ Add exercise" for a coach driving an
// in-person session: "push day, 4 sets of bench at 185, 3 sets of
// overhead press." Explicitly scoped to today's session only (the API
// route itself refuses a multi-week-sounding request). Writes through
// the exact same session_exercises/set_logs shape session-logger.tsx's
// own handleAddExercise already uses, just for N exercises with real
// sets pre-filled instead of one empty exercise the coach fills in by
// hand. Confirm-before-save, same as every other AI estimate in this
// app — never silently written.
export function QuickAddNlButton({
  sessionId,
  nextExerciseOrder,
  onAdded,
}: {
  sessionId: string;
  nextExerciseOrder: number;
  onAdded: (entries: SessionExerciseEntry[]) => void;
}) {
  const [open, setOpen] = useState(false);
  const [text, setText] = useState("");
  const [parsing, setParsing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [draft, setDraft] = useState<ParsedExercise[] | null>(null);

  async function handleParse() {
    if (!text.trim()) return;
    setParsing(true);
    setError(null);
    try {
      const res = await fetch("/api/ai/parse-session-nl", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error ?? "Couldn't parse that.");
        return;
      }
      setDraft(data.exercises);
    } finally {
      setParsing(false);
    }
  }

  async function handleConfirm() {
    if (!draft || draft.length === 0) return;
    setSaving(true);
    try {
      const supabase = createBrowserClient();
      const newEntries: SessionExerciseEntry[] = [];
      let order = nextExerciseOrder;

      for (const ex of draft) {
        const insertPayload: Record<string, unknown> = {
          session_id: sessionId,
          exercise_name: ex.exerciseName,
          exercise_order: order++,
          is_added: true,
        };
        // Only override the default ['reps','weight'] tracked-field set
        // when RPE was actually mentioned — same fields a coach would
        // get manually adding the RPE column.
        if (ex.rpe != null) insertPayload.tracked_fields = ["reps", "weight", "rpe"];

        const { data: sessionExercise } = await supabase
          .from("session_exercises")
          .insert(insertPayload)
          .select("id, exercise_name, exercise_order, is_swapped, is_added, tracked_fields")
          .single();
        if (!sessionExercise) continue;

        const setRows = Array.from({ length: ex.sets }, (_, i) => ({
          session_exercise_id: sessionExercise.id,
          set_order: i,
          weight: ex.weight,
          reps: ex.reps,
          rpe: ex.rpe,
        }));
        const { data: sets } = await supabase
          .from("set_logs")
          .insert(setRows)
          .select(
            "id, set_order, weight, reps, rpe, rir, tempo, time_seconds, height, distance, rest_seconds, pace, status"
          );

        newEntries.push({
          id: sessionExercise.id,
          exerciseName: sessionExercise.exercise_name,
          exerciseOrder: sessionExercise.exercise_order,
          isSwapped: sessionExercise.is_swapped,
          isAdded: sessionExercise.is_added,
          trackedFields: sessionExercise.tracked_fields,
          videoUrl: null,
          youtubeUrl: null,
          notes: null,
          sets: (sets ?? []).map((s: any) => ({
            id: s.id,
            setOrder: s.set_order,
            weight: s.weight,
            reps: s.reps,
            rpe: s.rpe,
            rir: s.rir,
            tempo: s.tempo,
            timeSeconds: s.time_seconds,
            height: s.height,
            distance: s.distance,
            restSeconds: s.rest_seconds,
            pace: s.pace,
            status: s.status,
          })),
        });
      }

      onAdded(newEntries);
      setOpen(false);
      setText("");
      setDraft(null);
    } finally {
      setSaving(false);
    }
  }

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="w-full h-11 border border-steel/30 text-steel font-body text-sm active:border-rust active:text-rust transition-colors"
      >
        + Quick add (say it)
      </button>
    );
  }

  if (draft) {
    return (
      <div className="border border-rust/40 bg-rust/5 p-3 space-y-2">
        {draft.map((ex, i) => (
          <p key={i} className="font-body text-sm text-chalk">
            {ex.exerciseName} — {ex.sets} × {ex.reps ?? "?"}
            {ex.weight != null ? ` @ ${ex.weight}` : ""}
            {ex.rpe != null ? ` (RPE ${ex.rpe})` : ""}
          </p>
        ))}
        <div className="flex items-center gap-2 pt-1">
          <button
            type="button"
            onClick={handleConfirm}
            disabled={saving}
            className="h-9 px-4 bg-rust text-graphite font-body text-xs font-medium disabled:opacity-40"
          >
            {saving ? "Adding…" : "Confirm & add"}
          </button>
          <button
            type="button"
            onClick={() => setDraft(null)}
            disabled={saving}
            className="font-body text-xs text-steel disabled:opacity-40"
          >
            Try again
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-2">
      <textarea
        autoFocus
        value={text}
        onChange={(e) => setText(e.target.value)}
        placeholder='e.g. "4 sets of bench at 185 for 8, 3 sets of overhead press at 95 for 10"'
        rows={2}
        className="w-full bg-surface border border-steel/30 text-chalk px-3 py-2 font-body text-sm focus:outline-none focus:border-rust resize-none"
      />
      {error && <p className="font-body text-xs text-rust">{error}</p>}
      <div className="flex items-center gap-2">
        <button
          type="button"
          onClick={handleParse}
          disabled={parsing || !text.trim()}
          className="h-9 px-4 bg-rust text-graphite font-body text-xs font-medium disabled:opacity-40"
        >
          {parsing ? "Parsing…" : "Parse"}
        </button>
        <button
          type="button"
          onClick={() => {
            setOpen(false);
            setText("");
            setError(null);
          }}
          className="font-body text-xs text-steel"
        >
          Cancel
        </button>
      </div>
    </div>
  );
}
