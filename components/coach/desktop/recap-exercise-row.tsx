"use client";

import { useState } from "react";
import { createBrowserClient } from "@/lib/supabase/client";
import { fieldDef, orderTrackedFields, type TrackedField } from "@/lib/exercise-fields";
import { recapSetValue, type RecapExercise } from "@/lib/session-recap-data";
import { ChevronDown, ChevronUp } from "lucide-react";

function condensedSummary(exercise: RecapExercise): string {
  const first = exercise.sets[0];
  if (!first) return "No sets logged";
  const count = exercise.sets.length;
  if (exercise.trackedFields.includes("reps") && first.reps != null) {
    const weightPart = exercise.trackedFields.includes("weight") && first.weight != null
      ? ` · ${first.weight} lbs`
      : "";
    return `${count}×${first.reps}${weightPart}`;
  }
  if (exercise.trackedFields.includes("time") && first.timeSeconds != null) {
    return `${count}×${first.timeSeconds}s`;
  }
  return `${count} ${count === 1 ? "set" : "sets"}`;
}

// One logged exercise on today's recap card — independently collapsible
// (same expand/collapse-to-header-row interaction as the program
// builder's day cards, components/coach/desktop/day-card.tsx), with a
// coach-only note field that appears once expanded.
export function RecapExerciseRow({ exercise, groupId }: { exercise: RecapExercise; groupId: string }) {
  const [expanded, setExpanded] = useState(false);
  const [note, setNote] = useState(exercise.coachNote);
  const [saving, setSaving] = useState(false);

  async function handleNoteBlur() {
    if (note === exercise.coachNote) return;
    setSaving(true);
    const supabase = createBrowserClient();
    await supabase
      .from("session_exercise_coach_notes")
      .upsert(
        { session_exercise_id: exercise.sessionExerciseId, group_id: groupId, body: note, updated_at: new Date().toISOString() },
        { onConflict: "session_exercise_id" }
      );
    setSaving(false);
  }

  const fields = orderTrackedFields(exercise.trackedFields);

  return (
    <div className="border border-steel/20 bg-surface/30">
      <button
        type="button"
        onClick={() => setExpanded((v) => !v)}
        className="w-full flex items-center justify-between gap-3 px-4 py-3 text-left"
      >
        <span className="font-body font-medium text-sm flex items-center gap-2">
          {exercise.exerciseName}
          {exercise.isPr && <span title="New PR this session">🎉</span>}
        </span>
        <span className="flex items-center gap-3 shrink-0">
          <span className="font-body text-xs text-steel">{condensedSummary(exercise)}</span>
          {expanded ? <ChevronUp className="w-4 h-4 text-steel" /> : <ChevronDown className="w-4 h-4 text-steel" />}
        </span>
      </button>

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
                {exercise.sets.map((set, i) => (
                  <tr key={set.setOrder}>
                    <td className="font-body text-xs text-chalk pr-3 py-0.5">{i + 1}</td>
                    {fields.map((f) => (
                      <td key={f} className="font-body text-xs text-chalk pr-3 py-0.5">
                        {recapSetValue(set, f as TrackedField) ?? "—"}
                      </td>
                    ))}
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
              value={note}
              onChange={(e) => setNote(e.target.value)}
              onBlur={handleNoteBlur}
              placeholder="Coach-only — never visible to the athlete"
              disabled={saving}
              className="w-full h-9 bg-graphite border border-steel/30 text-chalk px-2 font-body text-xs focus:outline-none focus:border-rust disabled:opacity-60"
            />
          </div>
        </div>
      )}
    </div>
  );
}
