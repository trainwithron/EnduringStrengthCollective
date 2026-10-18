"use client";

import { useState } from "react";
import { createBrowserClient } from "@/lib/supabase/client";
import type { BuilderExercise } from "@/lib/types";
import { TARGET_COLUMN, fieldDef, type TrackedField } from "@/lib/exercise-fields";
import { useSaveToastChannel } from "./save-toast-channel";
import { confirmDialog } from "@/components/shared/confirm-dialog";
import { parseBulkValue } from "@/lib/bulk-edit-value";

type Mode = "all" | "class";

export function BulkEditDayPanel({
  exercises,
  onApplied,
  label = "Bulk edit",
}: {
  exercises: BuilderExercise[];
  // addedField: this exercise did not track the field before and now does (Rest on an exercise the AI wrote without one).
  onApplied: (updates: { exerciseId: string; field: TrackedField; value: string | number | null; highValue?: number | null; addedField?: boolean }[]) => void;
  label?: string;
}) {
  const { flashSaved, flashSaveError } = useSaveToastChannel();
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

  // Rest is always on offer: an exercise written without one gets it when you apply a rest (the AI only gives an exercise a rest when it said one).
  const availableFields = Array.from(new Set([...exercises.flatMap((e) => e.trackedFields), "rest" as TrackedField]));
  const [message, setMessage] = useState<string | null>(null);
  const hasAnyTier = exercises.some((e) => e.tier);

  // Writes one value onto every set of these exercises; an exercise that did not track the field starts tracking it (so the rest shows in the builder and the logger prescribes it).
  async function writeValue(supabase: ReturnType<typeof createBrowserClient>, target: BuilderExercise[], parsed: string | number | null, high: number | null, updates: { exerciseId: string; field: TrackedField; value: string | number | null; highValue?: number | null; addedField?: boolean }[]): Promise<boolean> {
    const setIds = target.flatMap((e) => e.sets.map((s) => s.id));
    if (setIds.length === 0) return true;
    const { error } = await supabase
      .from("group_workout_exercise_sets")
      // A rest always writes its high end too (empty for a single time), so a range never survives a change to one time.
      .update(field === "rest" ? { [TARGET_COLUMN[field]]: parsed, target_rest_max_seconds: high } : { [TARGET_COLUMN[field]]: parsed })
      .in("id", setIds);
    if (error) return false;
    let ok = true;
    for (const e of target) {
      const addField = parsed !== null && !e.trackedFields.includes(field);
      if (addField) {
        const { error: fieldError } = await supabase.from("group_workout_exercises").update({ tracked_fields: [...e.trackedFields, field] }).eq("id", e.id);
        if (fieldError) {
          ok = false;
          continue;
        }
      }
      updates.push({ exerciseId: e.id, field, value: parsed, highValue: field === "rest" ? high : undefined, addedField: addField });
    }
    return ok;
  }

  async function handleApply() {
    setMessage(null);
    // Read what was typed first. A blank used to write "nothing" onto every set, and a time the box could not read quietly became blank: both cleared the rest on a whole program.
    const entries = mode === "all" ? [{ tier: null as "A" | "B" | "C" | null, raw: value }] : (["A", "B", "C"] as const).map((tier) => ({ tier, raw: classValues[tier] })).filter((e) => e.raw.trim() !== "");
    const parsedEntries = [];
    for (const entry of entries) {
      const parsed = parseBulkValue(field, entry.raw);
      if (!parsed.ok) {
        setMessage(parsed.message);
        return;
      }
      parsedEntries.push({ tier: entry.tier, parsed });
    }
    if (parsedEntries.length === 0) {
      setMessage("Type a value to apply.");
      return;
    }
    if (parsedEntries.some((e) => e.parsed.blank) && !(await confirmDialog({ message: `Clear ${fieldDef(field).label} on every set?`, confirmLabel: "Clear" }))) return;

    setApplying(true);
    const supabase = createBrowserClient();
    const updates: { exerciseId: string; field: TrackedField; value: string | number | null; highValue?: number | null; addedField?: boolean }[] = [];
    let anyFailed = false;
    for (const entry of parsedEntries) {
      const target = entry.tier === null ? exercises : exercises.filter((e) => e.tier === entry.tier);
      if (!(await writeValue(supabase, target, entry.parsed.value, entry.parsed.ok && entry.parsed.highValue != null ? entry.parsed.highValue : null, updates))) anyFailed = true;
    }

    onApplied(updates);
    setApplying(false);
    setOpen(false);
    setValue("");
    setClassValues({ A: "", B: "", C: "" });

    if (anyFailed) {
      flashSaveError("Some values didn't save — check the affected exercises.");
    } else if (updates.length > 0) {
      flashSaved();
    }
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
              className={`h-6 px-2 font-body text-xs border ${
                mode === "all" ? "bg-rust text-graphite border-rust" : "border-steel/30 text-steel"
              }`}
            >
              All
            </button>
            <button
              type="button"
              onClick={() => setMode("class")}
              className={`h-6 px-2 font-body text-xs border ${
                mode === "class" ? "bg-rust text-graphite border-rust" : "border-steel/30 text-steel"
              }`}
            >
              By class
            </button>
          </div>
        )}
      </div>

      <select aria-label="Field to change"
        value={field}
        onChange={(e) => {
          setField(e.target.value as TrackedField);
          setMessage(null);
        }}
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
          <input aria-label="New value"
            type={fieldDef(field).kind === "number" && field !== "rest" && field !== "time" ? "number" : "text"}
            inputMode={field === "rest" || field === "time" ? "text" : undefined}
            value={value}
            onChange={(e) => setValue(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                handleApply();
              }
            }}
            placeholder={field === "rest" || field === "time" ? "90 or 1:30" : "Value"}
            className="w-24 h-8 bg-graphite border border-steel/30 text-chalk px-2 font-body text-xs"
          />
        </div>
      ) : (
        <div className="space-y-1.5">
          {(["A", "B", "C"] as const).map((tier) => (
            <label key={tier} className="flex items-center gap-2">
              <span className="font-body text-xs text-steel w-16">Class {tier}</span>
              <input
                type={fieldDef(field).kind === "number" && field !== "rest" && field !== "time" ? "number" : "text"}
                value={classValues[tier]}
                onChange={(e) => setClassValues((prev) => ({ ...prev, [tier]: e.target.value }))}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    e.preventDefault();
                    handleApply();
                  }
                }}
                placeholder={field === "rest" || field === "time" ? "90 or 1:30" : "Value"}
                className="w-24 h-8 bg-graphite border border-steel/30 text-chalk px-2 font-body text-xs"
              />
            </label>
          ))}
        </div>
      )}

      {message && (
        <p className="font-body text-xs text-rust" role="alert">
          {message}
        </p>
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
