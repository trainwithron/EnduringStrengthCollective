"use client";

import { confirmDialog } from "@/components/shared/confirm-dialog";
import { useEffect, useRef, useState } from "react";
import { useSetSave } from "./set-save-context";
import { useLiftUnit } from "./lift-unit-context";
import { liftCellText, liftDisplayValue, liftStoredFromInput } from "@/lib/lift-weight";
import { validateSetFieldInput, type SetFieldValidation } from "@/lib/set-field-validation";
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
import { isSetFilled } from "@/lib/set-complete";
import { InfoTip } from "@/components/shared/info-tip";
import { MAX_REST_SECONDS, formatRest, formatRestSpan, parseRestInput, restForSet } from "@/lib/rest-time";

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
      // On a touch screen a horizontal drag anywhere on the card is the swipe to the next exercise, so a cell never takes it over (a cell that captured the finger made the swipe impossible from most of the
      // card). The swipe-to-accept stays for a mouse or pen.
      if (!enabled || e.pointerType === "touch") return;
      startX.current = e.clientX;
      fired.current = false;
      // Without this, a real finger drag routinely moves off this
      // narrow input within a frame or two — the browser then delivers
      // pointermove to whatever's now underneath instead of here, and
      // the swipe silently stops tracking (reads as "unresponsive,"
      // not a rendering perf issue). Capturing the pointer keeps every
      // subsequent move event targeted at this element regardless of
      // where the finger actually is on screen.
      try {
        e.currentTarget.setPointerCapture(e.pointerId);
      } catch {
        // Pointer capture unsupported/blocked — the gesture still works
        // whenever the finger happens to stay over the element.
      }
    },
    onPointerMove: (e: React.PointerEvent) => {
      if (!enabled || startX.current == null || fired.current) return;
      if (Math.abs(e.clientX - startX.current) >= SWIPE_THRESHOLD_PX) {
        fired.current = true;
        onAccept();
      }
    },
    onPointerUp: (e: React.PointerEvent) => {
      startX.current = null;
      try {
        e.currentTarget.releasePointerCapture(e.pointerId);
      } catch {
        // No-op if it was never captured.
      }
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
  onTouched,
  setNumber,
  coachRest,
  coachRestMax,
}: {
  set: SetLogEntry;
  field: TrackedField;
  // The rest the coach prescribed for this set (own or inherited): shown here as a fixed time, not an input.
  coachRest?: number | null;
  // The high end when the coach gave a range (coachRest is the low end).
  coachRestMax?: number | null;
  readOnly: boolean;
  onChange: (patch: Partial<SetLogEntry>) => void;
  // The athlete interacted with this set (focused/blurred/swiped a cell) —
  // only then may a prefilled-from-the-program set count as done.
  onTouched: () => void;
  setNumber: number;
}) {
  const prop = ACTUAL_PROP[field] as keyof SetLogEntry;
  const value = set[prop];
  const { save, failedIds } = useSetSave();
  const unsaved = failedIds.has(set.id);
  // Weights are stored in pounds; a client who chose kilograms sees and types kilograms (lib/lift-weight.ts).
  const unit = useLiftUnit();
  // A rest is typed and shown as m:ss (90 shows as 1:30), the same as the rest the coach sets; every other field is the plain number.
  const shown = (v: unknown) =>
    v === null || v === undefined
      ? ""
      : field === "rest" && typeof v === "number"
        ? formatRest(v)
        : field === "weight" && typeof v === "number"
          ? liftCellText(v, unit)
          : String(v);
  const [draft, setDraft] = useState(shown(value));
  // A value that can't be saved (RPE 89, 5.5 reps) stays on screen with the
  // reason, instead of silently reverting or being saved as nonsense.
  const [invalid, setInvalid] = useState<string | null>(null);
  const def = fieldDef(field);
  const isNumeric = (def.kind === "number" || field === "reps") && field !== "rest"; // logged reps is always a real integer

  useEffect(() => {
    setDraft(shown(value));
    // eslint-disable-next-line react-hooks/exhaustive-deps
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

  // Just the number: the row's label already says what it is, and a longer hint does not fit in the cell.
  // The suggestion as text in the person's unit (a stored pound value shows as kilograms for a kilogram client).
  const suggestionText = suggestion === null || suggestion === undefined ? null : field === "weight" && typeof suggestion === "number" ? liftCellText(suggestion, unit) : String(suggestion);
  const placeholder = field === "rest" ? "m:ss" : suggestionText ?? "—";


  function commit(next: string | number | null) {
    // Weight is the one field the obstacle-unlock mechanic cares about —
    // a program's target pre-fills it into this same column before the
    // athlete has done anything, so "the value changed" can't be the
    // confirmation signal the way it is for every other field. Instead,
    // any real blur-commit on weight — even one that leaves the number
    // exactly as it was — flips weight_confirmed once and stays flipped,
    // giving the athlete a single low-friction tap to say "yes, that's
    // what I did" without requiring them to retype a number that was
    // already right.
    const needsConfirmWrite = field === "weight" && !set.weightConfirmed;
    if (next === value && !needsConfirmWrite) return;

    // Apply the change to this exercise's real set data immediately — the
    // completion-sync effect (and everything downstream of it: the
    // checkmark, the rest timer) reacts to this right away instead of
    // waiting on the write below.
    onChange({
      [prop]: next,
      ...(field === "weight" ? { weightConfirmed: next != null } : {}),
    } as Partial<SetLogEntry>);

    // The write goes through the save queue: the typed value STAYS on screen
    // if the connection is bad, retries with backoff, and shows as "not
    // saved" until it lands (it used to silently revert).
    const payload: Record<string, unknown> = { [ACTUAL_COLUMN[field]]: next };
    if (field === "weight") payload.weight_confirmed = next != null;
    save(set.id, payload);
  }

  function handleBlur() {
    // Focusing and leaving a cell is the athlete confirming this set.
    const checked: SetFieldValidation =
      field === "rest"
        ? (() => {
            const r = parseRestInput(draft, MAX_REST_SECONDS);
            // A bare number under 20 is probably minutes typed without a unit ("2" for 2:00), so it is asked for again rather than saved as 2 seconds.
            return r.ok && !r.bare ? { ok: true as const, value: r.seconds } : { ok: false as const, message: "Rest needs a time like 1:30." };
          })()
        : validateSetFieldInput(field, draft, unit);
    if (!checked.ok) {
      setInvalid(checked.message);
      return;
    }
    setInvalid(null);
    onTouched();
    // A weight typed in kilograms is saved once as pounds. A cell the person only looked at keeps its stored pounds exactly (the shown kilograms are rounded, so converting them back would drift).
    if (field === "weight" && unit === "kg" && typeof checked.value === "number") {
      const same = typeof value === "number" && liftDisplayValue(value, unit) === checked.value;
      commit(same ? (value as number) : liftStoredFromInput(checked.value, unit));
      return;
    }
    commit(checked.value);
  }

  const swipe = useSwipeGesture(() => {
    if (draft.trim() !== "" || suggestion == null) return;
    setDraft(suggestionText ?? String(suggestion));
    vibrateConfirm();
    onTouched();
    commit(suggestion);
  }, !readOnly && draft.trim() === "" && suggestion != null);

  // On a touch screen the swipe is the next exercise, so the grey suggested number is taken with one tap instead: the first tap on an empty cell fills it in (and does not open the keyboard), a second tap edits it.
  const touchTap = useRef(false);
  // Set when a filled box was just focused and its number selected (so the mouseup of that same tap does not drop the selection).
  const selectOnFocus = useRef(false);
  const tapAccepts = !readOnly && draft.trim() === "" && suggestion != null && field !== "rest";


  if (field === "rest" && coachRest != null) {
    return (
      <div
        className="w-12 h-11 shrink-0 flex items-center justify-center rounded-token-pill bg-surface/40 border border-steel/20 text-chalk font-body text-sm tabular-nums"
        aria-label={`Rest after set ${setNumber}: ${formatRestSpan(coachRest, coachRestMax)}, set by your coach`}
      >
        {coachRestMax != null ? `${Math.round(coachRest)}-${Math.round(coachRestMax)}` : formatRest(coachRest)}
      </div>
    );
  }

  return (
    <div className="relative w-12 h-11 shrink-0">
      <input
        type={isNumeric ? "number" : "text"}
        inputMode={isNumeric ? (field === "reps" ? "numeric" : "decimal") : undefined}
        aria-label={`${def.label} for set ${setNumber}${
          suggestion != null && draft.trim() === "" ? `, suggested ${suggestionText ?? suggestion}` : ""
        }`}
        placeholder={placeholder}
        value={draft}
        disabled={readOnly}
        onChange={(e) => {
          setDraft(e.target.value);
          if (invalid) setInvalid(null);
        }}
        aria-invalid={invalid ? true : undefined}
        // A box that already holds a number (a suggested one just taken, or one logged before) selects it when tapped, so typing replaces it (Ron, Oct 23: "I tap it ... and then I
        // type the 8 again, and then it'll give me 88 reps"). Selected again on the next frame for iPhone, which places the caret after the tap.
        onFocus={(e) => {
          const el = e.currentTarget;
          if (el.value === "") return;
          selectOnFocus.current = true;
          el.select();
          requestAnimationFrame(() => {
            if (document.activeElement === el) el.select();
          });
        }}
        onMouseUp={(e) => {
          // the click that focused the box would otherwise drop the selection
          if (selectOnFocus.current) e.preventDefault();
          selectOnFocus.current = false;
        }}
        onBlur={handleBlur}
        {...swipe}
        onPointerDown={(e) => {
          touchTap.current = e.pointerType === "touch";
          swipe.onPointerDown(e);
        }}
        onMouseDown={(e) => {
          if (touchTap.current && tapAccepts) e.preventDefault();
        }}
        onClick={() => {
          if (!touchTap.current || !tapAccepts || suggestion == null) return;
          touchTap.current = false;
          setDraft(suggestionText ?? String(suggestion));
          vibrateConfirm();
          onTouched();
          commit(suggestion);
        }}
        className={`w-12 h-11 rounded-token-pill font-body text-sm text-center focus:outline-none focus:border-rust disabled:opacity-60 ${
          unsaved ? "border-2 border-amber-400/70 " : ""
        }${
          invalid ? "border-2 border-rust " : ""
        }bg-surface border border-steel/30 text-chalk`}
      />
      {invalid && (
        <p
          role="alert"
          className="absolute top-full left-1/2 -translate-x-1/2 mt-0.5 z-20 w-max max-w-[10rem] bg-graphite border border-rust px-2 py-1 font-body text-xs text-chalk text-center"
        >
          {invalid}
        </p>
      )}
      {unsaved && (
        <span
          aria-hidden="true"
          title="Not saved yet"
          className="absolute -top-1 -right-1 w-2.5 h-2.5 rounded-full bg-amber-400 border border-graphite pointer-events-none"
        />
      )}
    </div>
  );
}

// No checkboxes (Ron, Sep 12: "I hate the checkboxes in the workout logger"): a set is done once it has weight AND reps (reps alone for a
// bodyweight movement; see lib/set-complete.ts), and reverts to pending if either gets cleared again. Every other field is optional and
// never blocks. With the grid organized by metric ROW instead of by set, there's no single component that owns one whole set's fields,
// so this renders invisibly once per set.
function SetCompletionSync({
  set,
  trackedFields,
  readOnly,
  touched,
  weightOptional,
  prescribedRestSeconds,
  onChange,
}: {
  set: SetLogEntry;
  trackedFields: TrackedField[];
  readOnly: boolean;
  // Bodyweight movements: reps alone complete the set (no typing 0 lbs).
  weightOptional: boolean;
  // The rest the coach prescribed for this set (own or inherited), or null. The client does not log it, so it is not needed to complete the set, and it is written
  // into the set's log when the set completes (so the logged history and the session-length check see the rest that was asked for).
  prescribedRestSeconds: number | null;
  // Whether the athlete has interacted with this set this session.
  touched: boolean;
  onChange: (patch: Partial<SetLogEntry>) => void;
}) {
  const { save } = useSetSave();
  const restPrescribed = prescribedRestSeconds != null;
  useEffect(() => {
    if (readOnly || set.status === "skipped") return;
    const trackedProps = orderTrackedFields(trackedFields)
      // A coach-prescribed rest is not something the client logs: it never completes the set either.
      .filter((f) => !(restPrescribed && f === "rest"))
      .map((f) => ACTUAL_PROP[f]);
    const allFilled = isSetFilled(set as unknown as Record<string, unknown>, trackedProps, weightOptional);

    function persist(patch: Partial<SetLogEntry>) {
      // Flip the status right away — this is what the checkmark and the
      // rest-timer trigger key off. The write is queued (and retried), never
      // reverted: reverting on failure made this effect fire again forever.
      // A rest the client typed is never overwritten: only an empty one takes the prescribed rest.
      const withRest: Partial<SetLogEntry> =
        patch.status === "completed" && prescribedRestSeconds != null && set.restSeconds == null ? { ...patch, restSeconds: prescribedRestSeconds } : patch;
      onChange(withRest);
      const payload: Record<string, unknown> = { ...patch };
      if (patch.status === "completed") {
        payload.completed_at = new Date().toISOString();
        if (withRest.restSeconds !== undefined) payload[ACTUAL_COLUMN.rest] = withRest.restSeconds;
      }
      save(set.id, payload);
    }

    // A set that merely arrived pre-filled from the program's targets is NOT
    // done: it only completes once the athlete has touched it. (It used to
    // complete itself on load, so a client could tap Complete without doing a
    // thing and log the whole program.)
    if (allFilled && set.status !== "completed" && touched) {
      persist({ status: "completed" });
    } else if (!allFilled && set.status === "completed" && touched) {
      // Only when the person changed a field this session: a completed set loaded from the database (one checked off before the checkboxes went) is never flipped back on load.
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
    prescribedRestSeconds,
    set.pace,
    set.status,
    readOnly,
    touched,
  ]);

  return null;
}

export function ExerciseSetGrid({
  sets,
  trackedFields,
  readOnly,
  onSetChange,
  weightOptional = false,
}: {
  sets: SetLogEntry[];
  weightOptional?: boolean;
  trackedFields: TrackedField[];
  readOnly: boolean;
  onSetChange: (setId: string, patch: Partial<SetLogEntry>) => void;
}) {
  const fields = orderTrackedFields(trackedFields);
  const { save } = useSetSave();
  // Sets the athlete has interacted with (see SetCompletionSync).
  const [touchedSetIds, setTouchedSetIds] = useState<Set<string>>(new Set());
  function markTouched(...ids: string[]) {
    setTouchedSetIds((prev) => {
      if (ids.every((id) => prev.has(id))) return prev;
      const next = new Set(prev);
      for (const id of ids) next.add(id);
      return next;
    });
  }


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
    // Filling the row replaces whatever the other sets already hold — ask first
    // if that would overwrite numbers the athlete entered.
    const overwrites = rest.filter((s) => s[prop] != null && s[prop] !== value).length;
    if (
      overwrites > 0 &&
      !await confirmDialog({
        message: `Replace the ${fieldDef(field).label} you already entered on ${overwrites} other ${overwrites === 1 ? "set" : "sets"} with set 1's value?`,
        confirmLabel: "Replace",
      })
    ) {
      return;
    }
    // Fill every other set's cell immediately — the bulk write happens in
    // the background instead of the whole row waiting on it.
    for (const s of rest) onSetChange(s.id, { [prop]: value } as Partial<SetLogEntry>);
    markTouched(first.id, ...rest.map((s) => s.id));
    // Each set's change goes through the save queue (retried, never reverted).
    for (const s of rest) save(s.id, { [ACTUAL_COLUMN[field]]: value });
  }

  // Real usage feedback: the old handle sat at the far left of the row,
  // past the field-label column — nothing marked where set 1 actually
  // was, so the drag had no reliable starting point ("I can't hardly get
  // it"). Moved to sit immediately left of set 1's own cell (the exact
  // spot the drag needs to start from) and drawn as a small solid dot —
  // still a real button with a full-height touch target, just a
  // precise, deliberately small visual mark rather than an icon that
  // reads as "drag me from anywhere in this wide area." A plain tap does
  // the identical thing as the drag — one action (propagate set 1's
  // value), two ways to trigger it — rather than a different, narrower
  // tap-only action, which would just reintroduce the same ambiguity
  // this fix exists to remove.
  function RowHandle({ field }: { field: TrackedField }) {
    const dragStartX = useRef<number | null>(null);
    const dragFired = useRef(false);
    if (readOnly || sets.length < 2) return <div className="w-8 shrink-0" />;
    return (
      <button
        type="button"
        aria-label={`Fill every set's ${fieldDef(field).label} with set 1's value — tap, or drag from here`}
        title="Tap, or drag from here, to fill every set"
        onPointerDown={(e) => {
          dragStartX.current = e.clientX;
          dragFired.current = false;
          // Same fix as the per-cell swipe gesture above — a 20px-wide
          // handle is trivially easy to drag a finger off of within a
          // frame or two; without capture, the drag loses tracking the
          // instant that happens and never crosses the threshold, which
          // reads as the gesture just not working rather than a
          // rendering slowdown.
          try {
            e.currentTarget.setPointerCapture(e.pointerId);
          } catch {
            // Pointer capture unsupported/blocked — falls back to
            // requiring the finger to stay over the handle.
          }
        }}
        onPointerMove={(e) => {
          if (dragStartX.current == null || dragFired.current) return;
          if (Math.abs(e.clientX - dragStartX.current) >= SWIPE_THRESHOLD_PX) {
            dragFired.current = true;
            vibrateConfirm();
            handlePropagateRow(field);
          }
        }}
        onPointerUp={(e) => {
          try {
            e.currentTarget.releasePointerCapture(e.pointerId);
          } catch {
            // No-op if it was never captured.
          }
        }}
        onClick={() => {
          // A real drag already fired this via onPointerMove above — the
          // click that follows pointerup would otherwise double-fire it.
          if (dragFired.current) return;
          vibrateConfirm();
          handlePropagateRow(field);
        }}
        className="w-8 h-11 shrink-0 flex items-center justify-center touch-none cursor-grab active:cursor-grabbing group"
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
          touched={touchedSetIds.has(set.id)}
          weightOptional={weightOptional}
          prescribedRestSeconds={(() => {
            const r = restForSet(sets, set.id);
            return r?.source === "coach" ? r.seconds : null;
          })()}
          onChange={(patch) => onSetChange(set.id, patch)}
        />
      ))}
      <div className="inline-flex flex-col gap-1 min-w-full">
        <div className="flex items-center gap-1.5">
          <div className="w-12 shrink-0" />
          <div className="w-8 shrink-0" />
          {sets.map((set, i) => {
            const warmup = set.setType === "warmup";
            // A done set's number turns green (this replaces the old checkbox row).
            const done = set.status === "completed";
            const doneMark = done ? "text-moss font-bold" : "";
            // Tap the set number to mark it a warm-up (it then never counts toward goals, records or your max) and tap again to undo.
            if (readOnly) {
              return (
                <span key={set.id} data-set-done={done || undefined} className={`w-12 shrink-0 text-center font-body text-xs ${doneMark || "text-steel"}`}>
                  {warmup ? "W" : i + 1}
                </span>
              );
            }
            return (
              <button
                key={set.id}
                type="button"
                aria-pressed={warmup}
                data-set-done={done || undefined}
                aria-label={`${warmup ? `Set ${i + 1} is a warm-up. Tap to make it a working set.` : `Mark set ${i + 1} as a warm-up`}${done ? " (done)" : ""}`}
                title={warmup ? "Warm-up (tap to change)" : "Tap to mark as a warm-up"}
                onClick={() => {
                  const next = warmup ? "working" : "warmup";
                  onSetChange(set.id, { setType: next });
                  save(set.id, { set_type: next });
                }}
                className={`w-12 shrink-0 min-h-9 text-center font-body text-xs ${doneMark || (warmup ? "text-rust font-bold" : "text-steel")}`}
              >
                {warmup ? "W" : i + 1}
              </button>
            );
          })}
        </div>

        {fields.map((field) => (
          <div key={field} className="flex items-center gap-1.5">
            <span className="w-12 shrink-0 font-body text-xs text-steel truncate flex items-center gap-1">
              {fieldDef(field).label}
              {field === "rpe" && (
                <InfoTip text="Rate of Perceived Exertion — how hard that set felt, 1 (easy) to 10 (max effort)." />
              )}
            </span>
            <RowHandle field={field} />
            {sets.map((set, i) => (
              <GridCell
                key={set.id}
                set={set}
                field={field}
                readOnly={readOnly}
                setNumber={i + 1}
                onTouched={() => markTouched(set.id)}
                onChange={(patch) => onSetChange(set.id, patch)}
                coachRest={(() => {
                  const r = restForSet(sets, set.id);
                  return r && r.source === "coach" ? r.seconds : null;
                })()}
                coachRestMax={(() => {
                  const r = restForSet(sets, set.id);
                  return r && r.source === "coach" ? r.maxSeconds ?? null : null;
                })()}
              />
            ))}
          </div>
        ))}
      </div>
    </div>
  );
}
