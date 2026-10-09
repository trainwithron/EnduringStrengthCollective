"use client";

import { useEffect, useId, useRef, useSyncExternalStore } from "react";
import { confirmStore, type ConfirmOptions } from "@/lib/confirm-store";

// Ask the person to confirm, in the page (not the browser's popup). Same shape as window.confirm, but awaited:
//   if (!(await confirmDialog("Delete this photo? This can't be undone."))) return;
export function confirmDialog(options: string | ConfirmOptions): Promise<boolean> {
  return confirmStore.ask(options);
}

// Mounted once, in the root layout. A dimmed overlay with the message, Cancel and the confirm button (red when the action destroys something). Esc, the dimmed area and Cancel all answer no; focus starts on
// Cancel for something destructive (so a stray Enter never deletes) and on the confirm button otherwise, and stays inside the box until it closes, then goes back to where it was.
export function ConfirmDialogHost() {
  const request = useSyncExternalStore(confirmStore.subscribe, confirmStore.getSnapshot, () => null);
  const cancelRef = useRef<HTMLButtonElement>(null);
  const confirmRef = useRef<HTMLButtonElement>(null);
  const titleId = useId();

  useEffect(() => {
    if (!request) return;
    const before = document.activeElement as HTMLElement | null;
    (request.destructive ? cancelRef.current : confirmRef.current)?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        e.stopPropagation(); // only the confirmation closes, not the sheet or menu it was opened from
        confirmStore.answer(false);
        return;
      }
      if (e.key === "Tab") {
        const first = cancelRef.current;
        const last = confirmRef.current;
        if (!first || !last) return;
        if (e.shiftKey && document.activeElement === first) {
          e.preventDefault();
          last.focus();
        } else if (!e.shiftKey && document.activeElement === last) {
          e.preventDefault();
          first.focus();
        }
      }
    };
    document.addEventListener("keydown", onKey, true);
    return () => {
      document.removeEventListener("keydown", onKey, true);
      before?.focus?.();
    };
  }, [request]);

  if (!request) return null;
  return (
    <div className="fixed inset-0 z-[200] flex items-center justify-center bg-black/60 px-4" onMouseDown={(e) => e.target === e.currentTarget && confirmStore.answer(false)}>
      <div role="alertdialog" aria-modal="true" aria-labelledby={titleId} className="w-full max-w-sm bg-surface border border-steel/30 p-5 text-chalk shadow-xl">
        <p id={titleId} className="font-body text-sm whitespace-pre-line break-words">
          {request.message}
        </p>
        <div className="mt-5 flex flex-wrap justify-end gap-2">
          <button
            ref={cancelRef}
            type="button"
            onClick={() => confirmStore.answer(false)}
            className="min-h-[44px] px-4 border border-steel/40 text-chalk font-body text-sm focus:outline-none focus:ring-2 focus:ring-chalk/60"
          >
            {request.cancelLabel}
          </button>
          <button
            ref={confirmRef}
            type="button"
            onClick={() => confirmStore.answer(true)}
            className={`min-h-[44px] px-4 font-body text-sm font-medium text-graphite focus:outline-none focus:ring-2 focus:ring-chalk/60 ${request.destructive ? "bg-rust" : "bg-chalk"}`}
          >
            {request.confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
