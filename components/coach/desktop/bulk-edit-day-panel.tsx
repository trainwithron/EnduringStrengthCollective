"use client";

import { useState } from "react";
import { createBrowserClient } from "@/lib/supabase/client";
import type { BuilderExercise } from "@/lib/types";
import { TRACKED_FIELD_DEFS, TARGET_COLUMN, TARGET_PROP, fieldDef, type TrackedField } from "@/lib/exercise-fields";

type Mode = "all" | "class";

export function BulkEditDayPanel({
  exercises,
  onApplied,
  label = "Bulk edit",
}: {
  exercises: BuilderExercise[];
  onApplied: (updates: { exerciseId: string; field: TrackedField; value: string | number | null }[]) => void;
  label?: string;
}) {
  const [open, setOpen] = useState(false);
  const [mode, setMode] = useState<Mode>("all");
  const [field, setField] = useState<TrackedField>("reps");
  const [value, setValue] = useState("");
  const [classValues, setClassValues] = useState<Record<"A" | "B" | "C", string>>({
    A: "",
    B: "",
    C: "",
  });
  const [applying, setApplying] = useState(false);

  const availableFields = Array.from(new Set(exercises.flatMap((e) => e.trackedFields)));
  const hasAnyTier = exercises.some((e) => e.tier);

  function parse(raw: string): string | number | null {
    const def = fieldDef(field);
    return def.kind === "number" ? (raw.trim() === "" ? null : Number(raw)) : raw.trim() || null;
  }

  async function handleApply() {
    setApplying(true);
    const supabase = createBrowserClient();
    const updates: { exerciseId: string; field: TrackedField; value: string | number | null }[] = [];

    if (mode === "all") {
      const parsed = parse(value);
      const setIds = exercises.flatMap((e) => e.sets.map((s) => s.id));
      if (setIds.length > 0) {
        await supabase
          .from("group_workout_exercise_sets")
          .update({ [TARGET_COLUMN[field]]: parsed })
          .in("id", setIds);
        for (const e of exercises) updates.push({ exerciseId: e.id, field, value: parsed });
      }
    } else {
      for (const tier of ["A", "B", "C"] as const) {
        const raw = classValues[tier];
        if (raw.trim() === "") continue;
        const parsed = parse(raw);
        const tierExercises = exercises.filter((e) => e.tier === tier);
        const setIds = tierExercises.flatMap((e) => e.sets.map((s) => s.id));
        if (setIds.length === 0) continue;
        await supabase
          .from("group_workout_exercise_sets")
          .update({ [TARGET_COLUMN[field]]: parsed })
          .in("id", setIds);
        for (const e of tierExercises) updates.push({ exerciseId: e.id, field, value: parsed });
      }
    }

    onApplied(updates);
    setApplying(false);
    setOpen(false);
    setValue("");
    setClassValues({ A: "", B: "", C: "" });
  }

  if (exercises.length === 0) return null;

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="font-body text-xs text-steel border border-steel/30 px-2 h-7 active:border-rust active:text-rust transition-colors"
      >
        {label}
      </button>
    );
  }

  return (
    <div className="border border-rust/40 bg-surface/60 p-3 space-y-2">
      <div className="flex items-center justify-between">
        <p className="font-body text-xs text-steel">Apply a value to every set.</p>
        {hasAnyTier && (
          <div className="flex gap-1">
            <button
              type="button"
              onClick={() => setMode("all")}
              className={`h-6 px-2 font-body text-[11px] border ${
                mode === "all" ? "bg-rust text-graphite border-rust" : "border-steel/30 text-steel"
              }`}
            >
              All
            </button>
            <button
              type="button"
              onClick={() => setMode("class")}
              className={`h-6 px-2 font-body text-[11px] border ${
                mode === "class" ? "bg-rust text-graphite border-rust" : "border-steel/30 text-steel"
              }`}
            >
              By class
            </button>
          </div>
        )}
      </div>

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

      {mode === "all" ? (
        <div className="flex items-center gap-2">
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
        </div>
      ) : (
        <div className="space-y-1.5">
          {(["A", "B", "C"] as const).map((tier) => (
            <label key={tier} className="flex items-center gap-2">
              <span className="font-body text-xs text-steel w-16">Class {tier}</span>
              <input
                type={fieldDef(field).kind === "number" ? "number" : "text"}
                value={classValues[tier]}
                onChange={(e) => setClassValues((prev) => ({ ...prev, [tier]: e.target.value }))}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    e.preventDefault();
                    handleApply();
                  }
                }}
                placeholder="Value"
                className="w-24 h-8 bg-graphite border border-steel/30 text-chalk px-2 font-body text-xs"
              />
            </label>
          ))}
        </div>
      )}

      <div className="flex gap-2 pt-1">
        <button
          type="button"
          onClick={handleApply}
          disabled={applying}
          className="h-8 px-3 bg-rust text-graphite font-body text-xs font-medium disabled:opacity-40"
        >
          {applying ? "Applying…" : "Apply"}
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
