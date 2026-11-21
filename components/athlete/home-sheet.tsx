"use client";

import { useEffect } from "react";
import { createPortal } from "react-dom";
import { X } from "lucide-react";
import { useDialogA11y, type EscapeAction } from "@/lib/use-dialog-a11y";
import { confirmDialog } from "@/components/shared/confirm-dialog";

// The pop-up the three tiles on a client's Home open (Ron, Nov 21: a tile must OPEN its thing, not scroll the page). A sheet from the bottom on a phone, a centred box on a wider screen.
// Focus moves into it and stays there, Escape or the close button closes it, and focus goes back to the tile that opened it (`returnFocusTo`, a selector: a tap on a phone does not always focus the tile).
// `guard` says what closing does while there is work in it: "close", "ask" (the question in `ask`, or "Discard what you have here?") or "block". Escape, the close button and a
// tap outside all go the same way.
export interface SheetAsk {
  message: string;
  confirmLabel: string;
  cancelLabel: string;
}
const DISCARD: SheetAsk = { message: "Discard what you have here?", confirmLabel: "Discard", cancelLabel: "Keep working" };

export function HomeSheet({
  open,
  title,
  showTitle = true,
  wide = false,
  onClose,
  guard,
  ask = DISCARD,
  returnFocusTo,
  focusFirstField = false,
  children,
}: {
  open: boolean;
  title: string;
  // false when what is inside already starts with its own heading (the check-in's "How are you feeling?"): the title is then only the dialog's name.
  showTitle?: boolean;
  wide?: boolean;
  onClose: () => void;
  guard?: () => EscapeAction;
  ask?: SheetAsk;
  returnFocusTo?: string;
  // Focus the first box to type in, not the close button (Nutrition's Set my targets, audit C10).
  focusFirstField?: boolean;
  children: React.ReactNode;
}) {
  function requestClose() {
    const action = guard?.() ?? "close";
    if (action === "block") return;
    if (action === "ask") {
      void confirmDialog({ message: ask.message, confirmLabel: ask.confirmLabel, cancelLabel: ask.cancelLabel, destructive: true }).then((yes) => {
        if (yes) onClose();
      });
      return;
    }
    onClose();
  }

  // Escape asks this sheet's own question (with its own buttons), so the dialog helper is told "block" and the question is asked here.
  const ref = useDialogA11y<HTMLDivElement>(open, onClose, undefined, {
    guard: () => {
      const action = guard?.() ?? "close";
      if (action !== "ask") return action;
      requestClose();
      return "block";
    },
  });

  useEffect(() => {
    if (!open || !focusFirstField) return;
    ref.current?.querySelector<HTMLElement>('input:not([type="hidden"]):not([type="checkbox"]):not([disabled]), select:not([disabled]), textarea:not([disabled])')?.focus();
  }, [open, focusFirstField, ref]);

  useEffect(() => {
    if (!open || !returnFocusTo) return;
    return () => document.querySelector<HTMLElement>(returnFocusTo)?.focus();
  }, [open, returnFocusTo]);

  if (!open) return null;

  const sheet = (
    <div
      className="fixed inset-0 z-50 flex items-end sm:items-center sm:justify-center bg-black/60 sm:p-6"
      onClick={(e) => {
        if (e.target === e.currentTarget) requestClose();
      }}
      data-home-sheet
    >
      <div
        ref={ref}
        role="dialog"
        aria-modal="true"
        aria-label={title}
        className={`w-full ${wide ? "sm:max-w-2xl" : "sm:max-w-md"} max-h-[92dvh] overflow-y-auto bg-surface rounded-t-card sm:rounded-card px-5 pt-3 pb-[max(1.5rem,env(safe-area-inset-bottom))]`}
      >
        <div className={`flex items-center gap-3 ${showTitle ? "justify-between mb-2" : "justify-end -mb-2"}`}>
          {showTitle && <h2 className="font-body text-[15px] font-semibold text-chalk">{title}</h2>}
          <button type="button" onClick={requestClose} aria-label="Close" className="h-11 w-11 -mr-2 shrink-0 flex items-center justify-center rounded-full text-steel active:bg-surface-2">
            <X className="w-5 h-5" aria-hidden="true" />
          </button>
        </div>
        {children}
      </div>
    </div>
  );
  // (no document while a test renders it to text: then it is drawn in place)
  return typeof document === "undefined" ? sheet : createPortal(sheet, document.body);
}
