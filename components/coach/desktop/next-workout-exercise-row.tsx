"use client";

import { useEffect, useState } from "react";
import { createBrowserClient } from "@/lib/supabase/client";
import {
  TARGET_COLUMN,
  TARGET_PROP,
  fieldDef,
  formatCondensedSets,
  orderTrackedFields,
} from "@/lib/exercise-fields";
import type { WorkoutOverviewExercise } from "@/lib/workout-overview-data";
import type { ExerciseSetTarget } from "@/lib/types";
import { ChevronDown, ChevronUp } from "lucide-react";

// A single editable target field, prefilled with whatever's already
// prescribed — never blank, never re-computed. Shown gray/italic (the
// same "untouched suggestion" convention already used for the
// correlating-week weight suggestion) until the coach actually edits it,
// snapping to solid chalk from then on, same as every other program-
// builder target cell (components/coach/exercise-builder-card.tsx's
// TargetCell, which this mirrors).
function EditableTargetCell({
  setId,
  value,
  kind,
  label,
  onCommit,
}: {
  setId: string;
  value: string;
  kind: "number" | "text";
  label: string;
  onCommit: (raw: string) => void;
}) {
  const [draft, setDraft] = useState(value);
  const [touched, setTouched] = useState(false);

  useEffect(() => {
    setDraft(value);
  }, [value]);

  function commit() {
    if (draft !== value) onCommit(draft);
  }

  return (
    <input
      type={kind === "number" ? "number" : "text"}
      inputMode={kind === "number" ? "decimal" : undefined}
      min={kind === "number" ? "0" : undefined}
      aria-label={label}
      value={draft}
      onFocus={() => setTouched(true)}
      onChange={(e) => {
        setTouched(true);
        setDraft(e.target.value);
      }}
      onBlur={commit}
      onKeyDown={(e) => {
        if (e.key === "Enter") {
          e.preventDefault();
          commit();
          e.currentTarget.blur();
        }
      }}
      className={`w-16 h-9 bg-graphite border border-steel/30 px-1 font-body text-xs text-center focus:outline-none focus:border-rust ${
        touched ? "text-chalk" : "text-steel italic"
      }`}
      data-set-id={setId}
    />
  );
}

export function NextWorkoutExerciseRow({
  exercise,
  carriedForwardNote,
  onSwap,
}: {
  exercise: WorkoutOverviewExercise;
  carriedForwardNote?: { body: string; date: string };
  onSwap: (exerciseId: string, currentName: string) => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const [sets, setSets] = useState(exercise.sets);
  // The exercise's own existing `notes` column (already used for
  // template-level coach notes elsewhere in the builder) is the real,
  // already-saved value once it has content. Until then, the carried-
  // forward note from this athlete's most recent session with this
  // exercise is shown as the same kind of grayed, editable suggestion —
  // saving writes through to that same existing column, reusing it
  // rather than inventing new schema for a note on a workout that
  // hasn't started yet.
  const [noteDraft, setNoteDraft] = useState(exercise.notes ?? carriedForwardNote?.body ?? "");
  const [noteTouched, setNoteTouched] = useState(Boolean(exercise.notes));

  const fields = orderTrackedFields(exercise.trackedFields);
  const isCarriedForward = !exercise.notes && Boolean(carriedForwardNote);

  async function commitSetField(setId: string, field: (typeof fields)[number], raw: string) {
    const supabase = createBrowserClient();
    const kind = fieldDef(field).kind;
    const value = raw.trim() === "" ? null : kind === "number" ? Number(raw) : raw.trim();
    await supabase
      .from("group_workout_exercise_sets")
      .update({ [TARGET_COLUMN[field]]: value })
      .eq("id", setId);
    setSets((prev) =>
      prev.map((s) => (s.id === setId ? { ...s, [TARGET_PROP[field]]: value } : s))
    );
  }

  async function commitNote() {
    if (noteDraft === (exercise.notes ?? "")) return;
    const supabase = createBrowserClient();
    await supabase.from("group_workout_exercises").update({ notes: noteDraft }).eq("id", exercise.id);
  }

  return (
    <div className="border border-steel/20 bg-surface/30">
      <div className="w-full flex items-center justify-between gap-3 px-4 py-3">
        <button
          type="button"
          onClick={() => setExpanded((v) => !v)}
          className="flex-1 flex items-center justify-between gap-3 text-left"
        >
          <span className="font-body font-medium text-sm">{exercise.exerciseName}</span>
          <span className="flex items-center gap-3 shrink-0">
            <span className="font-body text-xs text-steel">
              {formatCondensedSets(sets, exercise.trackedFields)}
            </span>
            {expanded ? <ChevronUp className="w-4 h-4 text-steel" /> : <ChevronDown className="w-4 h-4 text-steel" />}
          </span>
        </button>
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            onSwap(exercise.id, exercise.exerciseName);
          }}
          className="font-body text-xs text-rust shrink-0"
        >
          Swap
        </button>
      </div>

      {expanded && (
        <div className="px-4 pb-4 space-y-3">
          <div className="overflow-x-auto">
            <table className="w-full text-left">
              <thead>
                <tr>
                  <th className="font-body text-[11px] text-steel uppercase pr-3 pb-1">Set</th>
                  {fields.map((f) => (
                    <th key={f} className="font-body text-[11px] text-steel uppercase pr-3 pb-1">
                      {fieldDef(f).label}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {sets.map((set: ExerciseSetTarget, i) => (
                  <tr key={set.id}>
                    <td className="font-body text-xs text-chalk pr-3 py-1">{i + 1}</td>
                    {fields.map((f) => {
                      const prop = TARGET_PROP[f] as keyof ExerciseSetTarget;
                      const v = set[prop];
                      return (
                        <td key={f} className="pr-3 py-1">
                          <EditableTargetCell
                            setId={set.id}
                            value={v === null || v === undefined ? "" : String(v)}
                            kind={fieldDef(f).kind}
                            label={`${fieldDef(f).label} for set ${i + 1}`}
                            onCommit={(raw) => commitSetField(set.id, f, raw)}
                          />
                        </td>
                      );
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div>
            <label className="font-body text-[11px] text-steel uppercase tracking-wide block mb-1">
              Note for this exercise
            </label>
            <input
              type="text"
              value={noteDraft}
              onFocus={() => setNoteTouched(true)}
              onChange={(e) => {
                setNoteTouched(true);
                setNoteDraft(e.target.value);
              }}
              onBlur={commitNote}
              placeholder="Coach-only — never visible to the athlete"
              className={`w-full h-9 bg-graphite border border-steel/30 px-2 font-body text-xs focus:outline-none focus:border-rust ${
                noteTouched ? "text-chalk" : "text-steel italic"
              }`}
            />
            {isCarriedForward && (
              <p className="font-body text-[11px] text-steel mt-1">
                Carried forward from {new Date(carriedForwardNote!.date).toLocaleDateString()}&apos;s note
              </p>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
