"use client";

import { useEffect, useRef, useState } from "react";
import { createBrowserClient } from "@/lib/supabase/client";
import type { SetLogEntry } from "@/lib/types";
import {
  ACTUAL_COLUMN,
  ACTUAL_PROP,
  TARGET_PROP,
  fieldDef,
  orderTrackedFields,
  type TrackedField,
} from "@/lib/exercise-fields";
import { parseNumericReps } from "@/lib/program-card-visuals";
import { Check } from "lucide-react";

// Metrics-as-rows, sets-as-columns — one row per tracked field (Reps,
// Weight, RPE, ...), one cell per set, scrolling horizontally instead of
// the whole exercise scrolling vertically through a stack of per-set
// rows. Two real reasons for this beyond fitting more sets on screen at
// once: it groups by metric so a coach/athlete can scan "are these sets
// consistent" across a whole row at a glance, and a left-right swipe
// gesture inside a row can't be confused with the page's own vertical
// scroll the way a horizontal swipe embedded in a vertically-stacked
// list of rows could.

const SWIPE_THRESHOLD_PX = 28;

function vibrateConfirm() {
  try {
    navigator.vibrate?.(30);
  } catch {
    // Vibration API unsupported/blocked — silently skip, never blocks
    // the actual commit.
  }
}

function useSwipeGesture(onAccept: () => void, enabled: boolean) {
  const startX = useRef<number | null>(null);
  const fired = useRef(false);
  return {
    onPointerDown: (e: React.PointerEvent) => {
      if (!enabled) return;
      startX.current = e.clientX;
      fired.current = false;
    },
    onPointerMove: (e: React.PointerEvent) => {
      if (!enabled || startX.current == null || fired.current) return;
      if (Math.abs(e.clientX - startX.current) >= SWIPE_THRESHOLD_PX) {
        fired.current = true;
        onAccept();
      }
    },
    onPointerUp: () => {
      startX.current = null;
    },
  };
}

// One editable cell: this set's own actual value for this field, with a
// grayed-out prescribed/suggested value as its placeholder while empty.
// Swiping within the cell accepts that placeholder — the correlating-
// week weight suggestion (lib/set-suggestions.ts) for the Weight row,
// the coach's prescribed value for every other row.
function GridCell({
  set,
  field,
  readOnly,
  onChange,
  setNumber,
}: {
  set: SetLogEntry;
  field: TrackedField;
  readOnly: boolean;
  onChange: (patch: Partial<SetLogEntry>) => void;
  setNumber: number;
}) {
  const prop = ACTUAL_PROP[field] as keyof SetLogEntry;
  const value = set[prop];
  const [draft, setDraft] = useState(value === null || value === undefined ? "" : String(value));
  const def = fieldDef(field);
  const isNumeric = def.kind === "number" || field === "reps"; // logged reps is always a real integer

  useEffect(() => {
    setDraft(value === null || value === undefined ? "" : String(value));
  }, [value]);

  // Weight's placeholder is the correlating-history suggestion (already
  // reconciled with any explicit coach target server-side); every other
  // field falls back to its plain prescribed target, same as before.
  const suggestion =
    field === "weight"
      ? set.suggestedWeight ?? null
      : field === "reps"
      ? parseNumericReps((set[TARGET_PROP.reps as keyof SetLogEntry] as string | null) ?? null)
      : (set[TARGET_PROP[field] as keyof SetLogEntry] as number | string | null | undefined) ?? null;

  const placeholder =
    suggestion !== null && suggestion !== undefined
      ? field === "weight"
        ? `${suggestion} lbs`
        : `${suggestion} (target)`
      : "—";

  async function commit(next: string | number | null) {
    if (next === value) return;
    const supabase = createBrowserClient();
    await supabase.from("set_logs").update({ [ACTUAL_COLUMN[field]]: next }).eq("id", set.id);
    onChange({ [prop]: next } as Partial<SetLogEntry>);
  }

  async function handleBlur() {
    const next = draft.trim() === "" ? null : isNumeric ? Number(draft) : draft.trim();
    await commit(next);
  }

  const swipe = useSwipeGesture(() => {
    if (draft.trim() !== "" || suggestion == null) return;
    setDraft(String(suggestion));
    vibrateConfirm();
    commit(suggestion);
  }, !readOnly && draft.trim() === "" && suggestion != null);

  return (
    <input
      type={isNumeric ? "number" : "text"}
      inputMode={isNumeric ? "decimal" : undefined}
      aria-label={`${def.label} for set ${setNumber}${
        suggestion != null && draft.trim() === "" ? `, suggested ${suggestion}` : ""
      }`}
      placeholder={placeholder}
      value={draft}
      disabled={readOnly}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={handleBlur}
      {...swipe}
      className="w-16 h-10 shrink-0 bg-surface border border-steel/30 rounded-token-pill text-chalk px-1 font-body text-sm text-center focus:outline-none focus:border-rust disabled:opacity-60 touch-pan-y"
    />
  );
}

// No more manual "mark complete" checkbox — a set is done once every
// field this exercise actually tracks has a value, and reverts to
// pending if one gets cleared again. Ported as-is from the old per-set
// SetRow component's own effect: with the grid now organized by metric
// ROW instead of by set, there's no single component left that owns one
// whole set's fields, so this renders invisibly once per set instead.
function SetCompletionSync({
  set,
  trackedFields,
  readOnly,
  onChange,
}: {
  set: SetLogEntry;
  trackedFields: TrackedField[];
  readOnly: boolean;
  onChange: (patch: Partial<SetLogEntry>) => void;
}) {
  useEffect(() => {
    if (readOnly || set.status === "skipped") return;
    const requiredProps = orderTrackedFields(trackedFields).map(
      (f) => ACTUAL_PROP[f] as keyof SetLogEntry
    );
    const allFilled =
      requiredProps.length > 0 &&
      requiredProps.every((prop) => {
        const v = set[prop];
        return v !== null && v !== undefined && v !== ("" as unknown);
      });

    async function persist(patch: Partial<SetLogEntry>) {
      const supabase = createBrowserClient();
      const payload: Record<string, unknown> = { ...patch };
      if (patch.status === "completed") payload.completed_at = new Date().toISOString();
      await supabase.from("set_logs").update(payload).eq("id", set.id);
      onChange(patch);
    }

    if (allFilled && set.status !== "completed") {
      persist({ status: "completed" });
    } else if (!allFilled && set.status === "completed") {
      persist({ status: "pending" });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    set.weight,
    set.reps,
    set.rpe,
    set.rir,
    set.tempo,
    set.timeSeconds,
    set.height,
    set.distance,
    set.restSeconds,
    set.pace,
    set.status,
    readOnly,
  ]);

  return null;
}

export function ExerciseSetGrid({
  sets,
  trackedFields,
  readOnly,
  onSetChange,
}: {
  sets: SetLogEntry[];
  trackedFields: TrackedField[];
  readOnly: boolean;
  onSetChange: (setId: string, patch: Partial<SetLogEntry>) => void;
}) {
  const fields = orderTrackedFields(trackedFields);

  // Swipe-to-fill (b): a per-row drag handle propagates set 1's current
  // value for THAT field across every other set in the row — scoped per
  // metric now that each metric is its own row, so filling in Rest
  // doesn't also overwrite Weight. Separate, separately-discoverable
  // gesture from each cell's own swipe-to-accept above.
  async function handlePropagateRow(field: TrackedField) {
    const first = sets[0];
    if (!first || sets.length < 2) return;
    const prop = ACTUAL_PROP[field] as keyof SetLogEntry;
    const value = first[prop];
    if (value == null) return;
    const rest = sets.slice(1);
    const supabase = createBrowserClient();
    await supabase
      .from("set_logs")
      .update({ [ACTUAL_COLUMN[field]]: value })
      .in("id", rest.map((s) => s.id));
    for (const s of rest) onSetChange(s.id, { [prop]: value } as Partial<SetLogEntry>);
  }

  // Real usage feedback: the old handle sat at the far left of the row,
  // past the field-label column — nothing marked where set 1 actually
  // was, so the drag had no reliable starting point ("I can't hardly get
  // it"). Moved to sit immediately left of set 1's own cell (the exact
  // spot the drag needs to start from) and drawn as a small solid dot —
  // still a real button with a full-height touch target, just a
  // precise, deliberately small visual mark rather than an icon that
  // reads as "drag me from anywhere in this wide area."
  function RowHandle({ field }: { field: TrackedField }) {
    const dragStartX = useRef<number | null>(null);
    const dragFired = useRef(false);
    if (readOnly || sets.length < 2) return <div className="w-5 shrink-0" />;
    return (
      <button
        type="button"
        aria-label={`Drag from here to fill every set's ${fieldDef(field).label} with set 1's value`}
        title="Drag from here to fill every set"
        onPointerDown={(e) => {
          dragStartX.current = e.clientX;
          dragFired.current = false;
        }}
        onPointerMove={(e) => {
          if (dragStartX.current == null || dragFired.current) return;
          if (Math.abs(e.clientX - dragStartX.current) >= SWIPE_THRESHOLD_PX) {
            dragFired.current = true;
            vibrateConfirm();
            handlePropagateRow(field);
          }
        }}
        className="w-5 h-10 shrink-0 flex items-center justify-center touch-none cursor-grab active:cursor-grabbing group"
      >
        <span className="w-2.5 h-2.5 rounded-full bg-steel group-active:bg-rust group-active:scale-125 transition-transform" />
      </button>
    );
  }

  return (
    <div className="overflow-x-auto -mx-1 px-1">
      {sets.map((set) => (
        <SetCompletionSync
          key={set.id}
          set={set}
          trackedFields={trackedFields}
          readOnly={readOnly}
          onChange={(patch) => onSetChange(set.id, patch)}
        />
      ))}
      <div className="inline-flex flex-col gap-1.5 min-w-full">
        <div className="flex items-center gap-1.5">
          <div className="w-16 shrink-0" />
          <div className="w-5 shrink-0" />
          {sets.map((set, i) => (
            <span key={set.id} className="w-16 shrink-0 text-center font-body text-xs text-steel">
              {i + 1}
            </span>
          ))}
        </div>

        {fields.map((field) => (
          <div key={field} className="flex items-center gap-1.5">
            <span className="w-16 shrink-0 font-body text-xs text-steel truncate">
              {fieldDef(field).label}
            </span>
            <RowHandle field={field} />
            {sets.map((set, i) => (
              <GridCell
                key={set.id}
                set={set}
                field={field}
                readOnly={readOnly}
                setNumber={i + 1}
                onChange={(patch) => onSetChange(set.id, patch)}
              />
            ))}
          </div>
        ))}

        <div className="flex items-center gap-1.5">
          <span className="w-16 shrink-0 font-body text-xs text-steel truncate">Status</span>
          <div className="w-5 shrink-0" />
          {sets.map((set) => {
            const isComplete = set.status === "completed";
            const isSkipped = set.status === "skipped";
            return (
              <span
                key={set.id}
                role="img"
                aria-label={isComplete ? "Set complete" : isSkipped ? "Set skipped" : "Set pending"}
                className={`w-16 h-8 shrink-0 flex items-center justify-center border rounded-token-circle ${
                  isComplete
                    ? "bg-moss border-moss text-graphite"
                    : isSkipped
                    ? "border-steel/30 text-steel/50"
                    : "border-steel/30 text-steel/30"
                }`}
              >
                <Check className="w-4 h-4" strokeWidth={3} />
              </span>
            );
          })}
        </div>
      </div>
    </div>
  );
}
