"use client";

import { Minus, Plus } from "lucide-react";

// "Sets  [-]  4  [+]": one row to take a set off or put one on while logging. Presentational only; the exercise card owns what happens.
export function SetStepper({
  count,
  canRemove,
  addBusy,
  onAdd,
  onRemove,
  prescribedNote,
  confirmText,
  onConfirmRemove,
  onKeep,
  undo,
}: {
  count: number;
  canRemove: boolean;
  addBusy: boolean;
  onAdd: () => void;
  onRemove: () => void;
  // "Prescribed 4", shown quietly when the athlete's count differs from what the coach prescribed.
  prescribedNote: string | null;
  // Set while a logged set is waiting for the athlete to confirm its removal.
  confirmText: string | null;
  onConfirmRemove: () => void;
  onKeep: () => void;
  // Set for a few seconds after a logged set was removed.
  undo: { text: string; pending: boolean; onUndo: () => void } | null;
}) {
  const stepBtn =
    "h-10 w-10 flex items-center justify-center border border-steel/30 text-steel active:border-rust active:text-rust transition-colors disabled:opacity-30 disabled:active:border-steel/30 disabled:active:text-steel";
  return (
    <div className="mt-2">
      <div className="flex items-center gap-3">
        <span className="font-body text-xs text-steel">Sets</span>
        <button type="button" onClick={onRemove} disabled={!canRemove} aria-label="Remove the last set" className={stepBtn}>
          <Minus className="w-4 h-4" aria-hidden="true" />
        </button>
        <span className="font-body text-sm font-medium text-chalk min-w-[1.5ch] text-center tabular-nums" aria-live="polite">
          {count}
        </span>
        <button type="button" onClick={onAdd} disabled={addBusy} aria-label="Add a set" className={stepBtn}>
          <Plus className="w-4 h-4" aria-hidden="true" />
        </button>
        {prescribedNote && <span className="font-body text-xs text-steel">{prescribedNote}</span>}
      </div>
      {confirmText && (
        <div className="mt-2 flex items-center gap-3" role="alert">
          <p className="font-body text-xs text-chalk">{confirmText}</p>
          <button type="button" onClick={onConfirmRemove} className="font-body text-xs text-rust">
            Remove
          </button>
          <button type="button" onClick={onKeep} className="font-body text-xs text-steel">
            Keep
          </button>
        </div>
      )}
      {undo && !confirmText && (
        <div className="mt-2 flex items-center gap-3" role="status">
          <p className="font-body text-xs text-steel">{undo.text}</p>
          <button type="button" onClick={undo.onUndo} disabled={undo.pending} className="font-body text-xs text-rust disabled:opacity-40">
            {undo.pending ? "Removing…" : "Undo"}
          </button>
        </div>
      )}
    </div>
  );
}
