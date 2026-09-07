"use client";

import { useState } from "react";
import { createBrowserClient } from "@/lib/supabase/client";
import type { BuilderExercise } from "@/lib/types";
import { TRACKED_FIELD_DEFS, TARGET_COLUMN, fieldDef, type TrackedField } from "@/lib/exercise-fields";

export function BulkEditDayPanel({
  exercises,
  onApplied,
}: {
  exercises: BuilderExercise[];
  onApplied: (field: TrackedField, value: string | number | null) => void;
}) {
  const [open, setOpen] = useState(false);
  const [field, setField] = useState<TrackedField>("reps");
  const [value, setValue] = useState("");
  const [applying, setApplying] = useState(false);

  const availableFields = Array.from(
    new Set(exercises.flatMap((e) => e.trackedFields))
  );

  async function handleApply() {
    const def = fieldDef(field);
    const parsed: string | number | null =
      def.kind === "number" ? (value.trim() === "" ? null : Number(value)) : value.trim() || null;

    const setIds = exercises.flatMap((e) => e.sets.map((s) => s.id));
    if (setIds.length === 0) return;

    setApplying(true);
    const supabase = createBrowserClient();
    await supabase
      .from("group_workout_exercise_sets")
      .update({ [TARGET_COLUMN[field]]: parsed })
      .in("id", setIds);
    onApplied(field, parsed);
    setApplying(false);
    setOpen(false);
    setValue("");
  }

  if (exercises.length === 0) return null;

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="font-body text-xs text-steel border border-steel/30 px-2 h-7 active:border-rust active:text-rust transition-colors"
      >
        Bulk edit
      </button>
    );
  }

  return (
    <div className="border border-rust/40 bg-surface/60 p-3 space-y-2">
      <p className="font-body text-xs text-steel">
        Apply one value to every set of every exercise in this day.
      </p>
      <div className="flex items-center gap-2">
        <select
          value={field}
          onChange={(e) => setField(e.target.value as TrackedField)}
          className="h-8 bg-graphite border border-steel/30 text-chalk px-2 font-body text-xs"
        >
          {availableFields.map((f) => (
            <option key={f} value={f}>
              {fieldDef(f).label}
            </option>
          ))}
        </select>
        <input
          type={fieldDef(field).kind === "number" ? "number" : "text"}
          value={value}
          onChange={(e) => setValue(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              handleApply();
            }
          }}
          placeholder="Value"
          className="w-24 h-8 bg-graphite border border-steel/30 text-chalk px-2 font-body text-xs"
        />
        <button
          type="button"
          onClick={handleApply}
          disabled={applying}
          className="h-8 px-3 bg-rust text-graphite font-body text-xs font-medium disabled:opacity-40"
        >
          {applying ? "Applying…" : "Apply to all"}
        </button>
        <button
          type="button"
          onClick={() => setOpen(false)}
          disabled={applying}
          className="h-8 px-3 border border-steel/30 text-steel font-body text-xs disabled:opacity-40"
        >
          Cancel
        </button>
      </div>
    </div>
  );
}
