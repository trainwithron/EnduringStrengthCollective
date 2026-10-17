"use client";

import { useEffect, useState } from "react";
import { clearUndo, subscribeUndo, UNDO_SECONDS, type UndoOffer } from "@/lib/undo-toast";

// "Deleted Back Squat. Undo" for a few seconds after a delete in the program builder. Mounted once at the top of the builder.
export function UndoToast() {
  const [offer, setOffer] = useState<UndoOffer | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => subscribeUndo(setOffer), []);
  useEffect(() => {
    if (!offer) return;
    const t = setTimeout(clearUndo, UNDO_SECONDS * 1000);
    return () => clearTimeout(t);
  }, [offer]);

  if (!offer) return null;
  return (
    <div role="status" aria-live="polite" className="fixed left-1/2 -translate-x-1/2 bottom-20 sm:bottom-6 z-50 max-w-[calc(100vw-2rem)] flex items-center gap-3 border border-steel/40 bg-graphite px-4 py-2.5 shadow-xl">
      <span className="font-body text-sm text-chalk">{offer.message}</span>
      <button
        type="button"
        disabled={busy}
        onClick={async () => {
          setBusy(true);
          try {
            await offer.onUndo();
          } finally {
            setBusy(false);
            clearUndo();
          }
        }}
        className="min-h-11 px-3 font-display font-bold uppercase tracking-wide text-rust disabled:opacity-40"
      >
        {busy ? "Putting back…" : "Undo"}
      </button>
    </div>
  );
}
