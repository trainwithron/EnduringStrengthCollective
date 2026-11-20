"use client";

import type { ReactNode } from "react";
import { Minus, Plus } from "lucide-react";

// "+ Add a set" (Look Refresh, client step, Ron Nov 20): the wide dashed button right under the set rows, beside Form check.
export function AddSetButton({ busy, onAdd }: { busy: boolean; onAdd: () => void }) {
  return (
    <button
      type="button"
      onClick={onAdd}
      disabled={busy}
      aria-label="Add a set"
      className="flex-1 min-w-0 h-11 rounded-row border border-dashed border-steel/60 text-steel font-body text-sm font-medium inline-flex items-center justify-center gap-1.5 active:border-rust active:text-rust transition-colors disabled:opacity-40"
    >
      <Plus className="w-4 h-4" aria-hidden="true" />
      Add a set
    </button>
  );
}

// "Sets  [-]  4": the quiet row under it to take the last set off, with the count. Presentational only; the exercise card owns what happens.
export function SetStepper({
  count,
  canRemove,
  onRemove,
  prescribedNote,
  confirmText,
  onConfirmRemove,
  onKeep,
  undo,
  trailing,
}: {
  count: number;
  canRemove: boolean;
  onRemove: () => void;
  // "Prescribed 4", shown quietly when the athlete's count differs from what the coach prescribed.
  prescribedNote: string | null;
  // Set while a logged set is waiting for the athlete to confirm its removal.
  confirmText: string | null;
  onConfirmRemove: () => void;
  onKeep: () => void;
  // Set for a few seconds after a logged set was removed.
  undo: { text: string; pending: boolean; onUndo: () => void } | null;
  // More controls on the same row, at its right end (the card's Edit metrics / Add weight / RPE), so they do not take a row of their own.
  trailing?: ReactNode;
}) {
  const stepBtn =
    "h-10 w-10 rounded-row flex items-center justify-center border border-steel/30 text-steel active:border-rust active:text-rust transition-colors disabled:opacity-30 disabled:active:border-steel/30 disabled:active:text-steel";
  return (
    <div className="mt-1">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
        <span className="font-body text-xs text-steel">Sets</span>
        <button type="button" onClick={onRemove} disabled={!canRemove} aria-label="Remove the last set" className={stepBtn}>
          <Minus className="w-4 h-4" aria-hidden="true" />
        </button>
        <span className="font-body text-sm font-medium text-chalk min-w-[1.5ch] text-center tabular-nums" aria-live="polite">
          {count}
        </span>
        {prescribedNote && <span className="font-body text-xs text-steel">{prescribedNote}</span>}
        {trailing && <div className="ml-auto flex items-center gap-3">{trailing}</div>}
      </div>
      {confirmText && (
        <div className="mt-2 flex items-center gap-3" role="alert">
          <p className="font-body text-xs text-chalk">{confirmText}</p>
          <button type="button" onClick={onConfirmRemove} className="min-h-11 px-2 -mx-2 font-body text-xs text-rust">
            Remove
          </button>
          <button type="button" onClick={onKeep} className="min-h-11 px-2 -mx-2 font-body text-xs text-steel">
            Keep
          </button>
        </div>
      )}
      {undo && !confirmText && (
        <div className="mt-2 flex items-center gap-3" role="status">
          <p className="font-body text-xs text-steel">{undo.text}</p>
          <button type="button" onClick={undo.onUndo} disabled={undo.pending} className="min-h-11 px-2 -mx-2 font-body text-xs text-rust disabled:opacity-40">
            {undo.pending ? "Removing…" : "Undo"}
          </button>
        </div>
      )}
    </div>
  );
}
