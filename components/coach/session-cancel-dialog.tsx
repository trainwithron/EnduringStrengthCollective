"use client";

import { useEffect, useState } from "react";
import { createBrowserClient } from "@/lib/supabase/client";
import { mirrorGoogleCalendarEvent } from "@/lib/mirror-google-calendar-event";

export interface CancelTarget {
  bookingId: string;
  seriesId: string | null;
  name: string;
  whenLabel: string;
}

// Click a booked session on the calendar, then cancel it here. A single session is cancelled the same way as from the client's panel (anything already taken for it goes back to their sessions).
// A session that belongs to a recurring schedule asks one more thing: just this one (the schedule carries on) or this one and every later one (the schedule ends).
export function CancelSessionDialog({ target, onClose, onDone }: { target: CancelTarget; onClose: () => void; onDone: () => void }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Escape keeps the session (closes the dialog) unless a cancel is already running.
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape" && !busy) onClose();
    }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [busy, onClose]);

  async function finish(ok: boolean) {
    setBusy(false);
    if (!ok) {
      setError("That didn't cancel. Nothing was changed.");
      return;
    }
    onDone();
    onClose();
  }

  async function cancelSingle() {
    setBusy(true);
    setError(null);
    const { error: cancelError } = await createBrowserClient().rpc("cancel_booking_and_refund_credit", { p_booking_id: target.bookingId });
    if (!cancelError) mirrorGoogleCalendarEvent(target.bookingId);
    await finish(!cancelError);
  }

  async function seriesAction(action: "skip" | "end_from_here") {
    setBusy(true);
    setError(null);
    let ok = false;
    try {
      const res = await fetch("/api/series/occurrence", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ bookingId: target.bookingId, action }),
      });
      ok = res.ok;
    } catch {
      ok = false;
    }
    await finish(ok);
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-graphite/70 px-4" role="presentation" onClick={busy ? undefined : onClose}>
      <div role="dialog" aria-modal="true" aria-label="Cancel this session" className="w-full max-w-sm bg-surface border border-steel/30 p-4" onClick={(e) => e.stopPropagation()}>
        <p className="font-display font-bold uppercase text-sm tracking-wide text-rust">Cancel a booked session</p>
        <p className="font-display font-bold text-lg leading-tight text-chalk mt-2">{target.name}</p>
        <p className="font-body text-sm text-chalk">{target.whenLabel}</p>
        <p className="font-body text-sm text-steel mt-3">
          This takes {target.name}&apos;s session off the calendar. It does not book anything. Anything already taken for it goes back to their sessions.
        </p>
        {error && (
          <p className="font-body text-xs text-rust mt-2" role="alert">
            {error}
          </p>
        )}
        <div className="mt-4 flex flex-col gap-2">
          {target.seriesId ? (
            <>
              <button type="button" disabled={busy} onClick={() => seriesAction("skip")} className="min-h-11 bg-rust text-graphite font-display font-bold uppercase tracking-wide px-4 py-2 disabled:opacity-40">
                {busy ? "Cancelling…" : `Cancel only this one (${target.whenLabel})`}
              </button>
              <button type="button" disabled={busy} onClick={() => seriesAction("end_from_here")} className="min-h-11 border border-rust text-rust font-display font-bold uppercase tracking-wide px-4 py-2 disabled:opacity-40">
                Cancel this one and every later one
              </button>
            </>
          ) : (
            <button type="button" disabled={busy} onClick={cancelSingle} className="min-h-11 bg-rust text-graphite font-display font-bold uppercase tracking-wide px-4 py-2 disabled:opacity-40">
              {busy ? "Cancelling…" : `Cancel ${target.name}'s session`}
            </button>
          )}
          <button type="button" disabled={busy} onClick={onClose} className="min-h-11 font-body text-sm text-steel">
            Keep the session
          </button>
        </div>
      </div>
    </div>
  );
}
