"use client";

import { useState } from "react";
import { createBrowserClient } from "@/lib/supabase/client";
import type { SetLogEntry } from "@/lib/types";
import { ACTUAL_COLUMN, ACTUAL_PROP, fieldDef, orderTrackedFields, type TrackedField } from "@/lib/exercise-fields";
import { Check } from "lucide-react";

// One of the "extra" tracked fields beyond weight/reps (RPE, RIR, Tempo,
// Time, Height, Distance) — same immediate-persist-per-field pattern as the
// weight/reps inputs below, kept in its own component so each field commits
// independently (a shared handler across fields caused a real bug earlier:
// tabbing between fields fired a premature save with the next field blank).
function ActualCell({
  set,
  field,
  readOnly,
  onChange,
}: {
  set: SetLogEntry;
  field: TrackedField;
  readOnly: boolean;
  onChange: (patch: Partial<SetLogEntry>) => void;
}) {
  const prop = ACTUAL_PROP[field] as keyof SetLogEntry;
  const initial = set[prop];
  const [draft, setDraft] = useState(initial === null || initial === undefined ? "" : String(initial));
  const def = fieldDef(field);

  async function handleBlur() {
    const value = draft.trim() === "" ? null : def.kind === "number" ? Number(draft) : draft.trim();
    if (value === initial) return;
    const supabase = createBrowserClient();
    await supabase.from("set_logs").update({ [ACTUAL_COLUMN[field]]: value }).eq("id", set.id);
    onChange({ [prop]: value } as Partial<SetLogEntry>);
  }

  return (
    <input
      type={def.kind === "number" ? "number" : "text"}
      inputMode={def.kind === "number" ? "decimal" : undefined}
      placeholder={def.label}
      value={draft}
      disabled={readOnly}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={handleBlur}
      className="w-14 h-10 bg-surface border border-steel/30 text-chalk px-1 font-body text-xs text-center focus:outline-none focus:border-rust disabled:opacity-60 shrink-0"
    />
  );
}

export function SetRow({
  set,
  setNumber,
  trackedFields,
  readOnly,
  onChange,
}: {
  set: SetLogEntry;
  setNumber: number;
  trackedFields: TrackedField[];
  readOnly: boolean;
  onChange: (patch: Partial<SetLogEntry>) => void;
}) {
  const [weight, setWeight] = useState(set.weight?.toString() ?? "");
  const [reps, setReps] = useState(set.reps?.toString() ?? "");
  const [saving, setSaving] = useState(false);

  async function persist(
    fields: Partial<Pick<SetLogEntry, "weight" | "reps" | "status">>
  ) {
    setSaving(true);
    const supabase = createBrowserClient();
    const payload: Record<string, unknown> = { ...fields };
    if (fields.status === "completed") {
      payload.completed_at = new Date().toISOString();
    }
    await supabase.from("set_logs").update(payload).eq("id", set.id);
    setSaving(false);
    // Send only the fields that changed — the parent merges this onto its
    // latest state via functional setState, so it's safe regardless of
    // which concurrent save (weight/reps vs. status) resolves last.
    onChange(fields);
  }

  // Committed independently per field — sharing one handler across both
  // inputs meant tabbing from weight to reps fired a premature save with
  // reps still blank, since blur fires before the next field's keystrokes.
  function handleWeightBlur() {
    const weightNum = weight === "" ? null : Number(weight);
    if (weightNum !== set.weight) {
      persist({ weight: weightNum });
    }
  }

  function handleRepsBlur() {
    const repsNum = reps === "" ? null : Number(reps);
    if (repsNum !== set.reps) {
      persist({ reps: repsNum });
    }
  }

  async function toggleComplete() {
    if (readOnly) return;
    const nextStatus = set.status === "completed" ? "pending" : "completed";
    await persist({ status: nextStatus });
  }

  const isComplete = set.status === "completed";
  const isSkipped = set.status === "skipped";
  const extraFields = orderTrackedFields(trackedFields).filter(
    (f) => f !== "reps" && f !== "weight"
  );

  return (
    <div className="flex items-center gap-2 flex-wrap">
      <span className="font-body text-xs text-steel w-4 shrink-0">{setNumber}</span>

      {trackedFields.includes("weight") && (
        <input
          type="number"
          inputMode="decimal"
          placeholder="lbs"
          value={weight}
          disabled={readOnly}
          onChange={(e) => setWeight(e.target.value)}
          onBlur={handleWeightBlur}
          className="w-20 h-10 bg-surface border border-steel/30 text-chalk px-2 font-body text-sm text-center focus:outline-none focus:border-rust disabled:opacity-60"
        />
      )}
      {trackedFields.includes("weight") && trackedFields.includes("reps") && (
        <span className="font-body text-xs text-steel">&times;</span>
      )}
      {trackedFields.includes("reps") && (
        <input
          type="number"
          inputMode="numeric"
          placeholder="reps"
          value={reps}
          disabled={readOnly}
          onChange={(e) => setReps(e.target.value)}
          onBlur={handleRepsBlur}
          className="w-16 h-10 bg-surface border border-steel/30 text-chalk px-2 font-body text-sm text-center focus:outline-none focus:border-rust disabled:opacity-60"
        />
      )}

      {extraFields.map((field) => (
        <ActualCell key={field} set={set} field={field} readOnly={readOnly} onChange={onChange} />
      ))}

      <button
        type="button"
        onClick={toggleComplete}
        disabled={readOnly || saving}
        aria-label={isComplete ? "Mark set incomplete" : "Mark set complete"}
        className={`ml-auto w-10 h-10 flex items-center justify-center border shrink-0 transition-colors ${
          isComplete
            ? "bg-moss border-moss text-graphite"
            : isSkipped
            ? "border-steel/30 text-steel/50"
            : "border-steel/30 text-steel active:border-rust active:text-rust"
        }`}
      >
        <Check className="w-4 h-4" strokeWidth={3} />
      </button>
    </div>
  );
}
