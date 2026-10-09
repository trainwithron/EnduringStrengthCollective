"use client";

import { confirmDialog } from "@/components/shared/confirm-dialog";
import { useEffect, useRef, useState } from "react";
import { useSetSave } from "./set-save-context";
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
import { isExerciseUnlocked, type PriorBest } from "@/lib/obstacle-unlock";
import { Check, Lock, LockOpen } from "lucide-react";
import { InfoTip } from "@/components/shared/info-tip";
import { MAX_REST_SECONDS, formatRest, parseRestInput, restForSet } from "@/lib/rest-time";

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
  locked,
  coachRest,
}: {
  set: SetLogEntry;
  field: TrackedField;
  // The rest the coach prescribed for this set (own or inherited): shown here as a fixed time, not an input.
  coachRest?: number | null;
  readOnly: boolean;
  onChange: (patch: Partial<SetLogEntry>) => void;
  // The athlete interacted with this set (focused/blurred/swiped a cell) —
  // only then may a prefilled-from-the-program set count as done.
  onTouched: () => void;
  setNumber: number;
  // Obstacle-unlock mechanic (lib/obstacle-unlock.ts, Phase 1 of the
  // gamified-logging thread) — only ever true for the weight cell of an
  // exercise that hasn't cleared its goal yet. The suggested weight
  // itself still shows (an athlete needs the real number to train), this
  // just adds the lock badge signaling there's a goal to beat.
  locked?: boolean;
}) {
  const prop = ACTUAL_PROP[field] as keyof SetLogEntry;
  const value = set[prop];
  const { save, failedIds } = useSetSave();
  const unsaved = failedIds.has(set.id);
  // A rest is typed and shown as m:ss (90 shows as 1:30), the same as the rest the coach sets; every other field is the plain number.
  const shown = (v: unknown) => (v === null || v === undefined ? "" : field === "rest" && typeof v === "number" ? formatRest(v) : String(v));
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
  const placeholder = field === "rest" ? "m:ss" : suggestion !== null && suggestion !== undefined ? String(suggestion) : "—";

  // What the obstacle-unlock mechanic protects — NOT the same thing as
  // `suggestion` above, which the server deliberately nulls out the
  // instant weight has a real value (it's a swipe-to-accept placeholder,
  // pointless once already filled). A program's real target_weight stays
  // present on the set regardless of fill state, which is exactly what's
  // needed here: the lock has to keep showing over an already-pre-filled
  // value, not just an empty one.
  const hasGoalToProtect = field === "weight" && (set.targetWeight != null || suggestion != null);

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
            return r.ok ? { ok: true as const, value: r.seconds } : { ok: false as const, message: "Rest needs a time like 1:30." };
          })()
        : validateSetFieldInput(field, draft);
    if (!checked.ok) {
      setInvalid(checked.message);
      return;
    }
    setInvalid(null);
    onTouched();
    commit(checked.value);
  }

  const swipe = useSwipeGesture(() => {
    if (draft.trim() !== "" || suggestion == null) return;
    setDraft(String(suggestion));
    vibrateConfirm();
    onTouched();
    commit(suggestion);
  }, !readOnly && draft.trim() === "" && suggestion != null);

  // Decoupled from whether the cell is empty — pre-filled and swiped-in
  // values show the overlay too, as long as this exercise's goal hasn't
  // actually been cleared yet (a coach-set target auto-fills the exact
  // value it's asking the athlete to hit, so "the cell has a value" was
  // never a meaningful signal that the goal had actually been attempted).
  const showLock = !!locked && hasGoalToProtect;

  if (field === "rest" && coachRest != null) {
    return (
      <div
        className="w-16 h-11 shrink-0 flex items-center justify-center rounded-token-pill bg-surface/40 border border-steel/20 text-chalk font-body text-sm tabular-nums"
        aria-label={`Rest after set ${setNumber}: ${formatRest(coachRest)}, set by your coach`}
      >
        {formatRest(coachRest)}
      </div>
    );
  }

  return (
    <div className="relative w-16 h-11 shrink-0">
      <input
        type={isNumeric ? "number" : "text"}
        inputMode={isNumeric ? (field === "reps" ? "numeric" : "decimal") : undefined}
        aria-label={`${def.label} for set ${setNumber}${
          suggestion != null && draft.trim() === "" ? `, suggested ${suggestion}` : ""
        }${showLock ? " — locked, beat this to unlock it" : ""}`}
        placeholder={placeholder}
        value={draft}
        disabled={readOnly}
        onChange={(e) => {
          setDraft(e.target.value);
          if (invalid) setInvalid(null);
        }}
        aria-invalid={invalid ? true : undefined}
        onBlur={handleBlur}
        {...swipe}
        className={`w-16 h-11 rounded-token-pill font-body text-sm text-center focus:outline-none focus:border-rust disabled:opacity-60 touch-pan-y ${
          unsaved ? "border-2 border-amber-400/70 " : ""
        }${
          invalid ? "border-2 border-rust " : ""
        }${
          showLock
            ? "bg-surface border-2 border-dashed border-rust/70 text-chalk/50"
            : "bg-surface border border-steel/30 text-chalk"
        }`}
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
      {showLock && (
        <>
          {/* A real veil over the number, not just a frame around it — dims
              it (still readable if you look, satisfying that the athlete
              needs the real number to train by) without fully hiding it,
              so it reads as "something to break through" rather than "a
              badge decorating a fully-normal value." */}
          <div
            aria-hidden="true"
            className="absolute inset-0 rounded-token-pill bg-rust/15 pointer-events-none"
          />
          <div
            aria-hidden="true"
            className="absolute -bottom-1.5 -right-1.5 w-5 h-5 rounded-full bg-graphite border-2 border-rust flex items-center justify-center pointer-events-none animate-[obstacle-lock-pulse_1.6s_ease-in-out_infinite]"
          >
            <Lock className="w-2.5 h-2.5 text-rust" strokeWidth={3} />
          </div>
        </>
      )}
    </div>
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
    const requiredProps = orderTrackedFields(trackedFields)
      .filter((f) => !(weightOptional && f === "weight"))
      // A coach-prescribed rest is not something the client logs: it is not needed to complete the set.
      .filter((f) => !(restPrescribed && f === "rest"))
      .map((f) => ACTUAL_PROP[f] as keyof SetLogEntry);
    const allFilled =
      requiredProps.length > 0 &&
      requiredProps.every((prop) => {
        const v = set[prop];
        return v !== null && v !== undefined && v !== ("" as unknown);
      });

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
  priorBest,
  gamificationEnabled = true,
  weightOptional = false,
}: {
  sets: SetLogEntry[];
  weightOptional?: boolean;
  trackedFields: TrackedField[];
  readOnly: boolean;
  onSetChange: (setId: string, patch: Partial<SetLogEntry>) => void;
  priorBest?: PriorBest;
  gamificationEnabled?: boolean;
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

  // Obstacle-unlock (Phase 1 of the gamified-logging thread,
  // lib/obstacle-unlock.ts) — re-derived from the exercise's real current
  // sets on every render rather than stored as separate state, so it's
  // always consistent with whatever's actually logged (including surviving
  // a reload, or self-correcting if a cleared value gets edited back
  // down). Off entirely when gamification is disabled for this group, or
  // once any set proves the goal cleared.
  const unlocked =
    !gamificationEnabled ||
    isExerciseUnlocked(
      sets.map((s) => ({
        weight: s.weight,
        reps: s.reps,
        targetWeight: s.targetWeight ?? null,
        targetReps: s.targetReps ?? null,
        weightConfirmed: !!s.weightConfirmed,
      })),
      priorBest ?? { maxWeight: null, maxReps: null, maxVolume: null }
    );

  // One-shot "defeated the obstacle" feedback exactly at the moment it
  // flips from locked to unlocked — never on the initial locked or
  // already-unlocked render, and never again afterward for this exercise
  // instance (matches "the unlock persists," not a repeated animation).
  const [justUnlocked, setJustUnlocked] = useState(false);
  const wasUnlocked = useRef(unlocked);
  useEffect(() => {
    if (unlocked && !wasUnlocked.current) {
      vibrateConfirm();
      setJustUnlocked(true);
      const t = setTimeout(() => setJustUnlocked(false), 900);
      wasUnlocked.current = unlocked;
      return () => clearTimeout(t);
    }
    wasUnlocked.current = unlocked;
  }, [unlocked]);

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
      !await confirmDialog(
        `Replace the ${fieldDef(field).label} you already entered on ${overwrites} other ${overwrites === 1 ? "set" : "sets"} with set 1's value?`
      )
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
      <div className="inline-flex flex-col gap-1.5 min-w-full">
        <div className="flex items-center gap-1.5">
          <div className="w-16 shrink-0" />
          <div className="w-8 shrink-0" />
          {sets.map((set, i) => (
            <span key={set.id} className="w-16 shrink-0 text-center font-body text-xs text-steel">
              {i + 1}
            </span>
          ))}
        </div>

        {fields.map((field) => (
          <div key={field} className="flex items-center gap-1.5">
            <span className="w-16 shrink-0 font-body text-xs text-steel truncate flex items-center gap-1">
              {fieldDef(field).label}
              {field === "rpe" && (
                <InfoTip text="Rate of Perceived Exertion — how hard that set felt, 1 (easy) to 10 (max effort)." />
              )}
              {field === "weight" && justUnlocked && (
                <LockOpen
                  aria-hidden="true"
                  className="w-3 h-3 text-rust animate-[obstacle-unlock-pop_0.7s_ease-out]"
                />
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
                locked={field === "weight" && !unlocked}
                coachRest={(() => {
                  const r = restForSet(sets, set.id);
                  return r && r.source === "coach" ? r.seconds : null;
                })()}
              />
            ))}
          </div>
        ))}

        <div className="flex items-center gap-1.5">
          <span className="w-16 shrink-0 font-body text-xs text-steel truncate">Status</span>
          <div className="w-8 shrink-0" />
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
                    ? "border-steel/30 text-steel"
                    : "border-steel/30 text-steel"
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
