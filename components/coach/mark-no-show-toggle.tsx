"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { createBrowserClient } from "@/lib/supabase/client";

// scheduling_calendar_spotter_idea.md: a past confirmed booking is presumed attended unless the coach flags it, so this is the one attendance control on the day page (only for a booking whose
// start time has passed). FIX 3 (Ron: every booking ends as happened, no-show or late cancel, with Charge or Waive): "Mark no-show" asks Charge 1 session or Waive (resolve_no_show);
// Undo puts it back to an ordinary unmarked session and gives back only what the no-show took (set_booking_no_show false).
export function MarkNoShowToggle({
  bookingId,
  initialNoShow,
}: {
  bookingId: string;
  initialNoShow: boolean;
}) {
  const [noShow, setNoShow] = useState(initialNoShow);
  const [asking, setAsking] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const router = useRouter();

  async function mark(charge: boolean) {
    setBusy(true);
    setError(null);
    const { error: rpcError } = await createBrowserClient().rpc("resolve_no_show", { p_booking_id: bookingId, p_charge: charge });
    setBusy(false);
    if (rpcError) {
      setError("That didn't save. Nothing was changed.");
      return;
    }
    setNoShow(true);
    setAsking(false);
    router.refresh();
  }

  async function undo() {
    setBusy(true);
    setError(null);
    const { error: rpcError } = await createBrowserClient().rpc("set_booking_no_show", { p_booking_id: bookingId, p_no_show: false });
    setBusy(false);
    if (rpcError) {
      setError("That didn't save. Nothing was changed.");
      return;
    }
    setNoShow(false);
    router.refresh();
  }

  if (noShow) {
    return (
      <span className="inline-flex flex-col items-start gap-1">
        <button type="button" onClick={undo} disabled={busy} className="h-8 px-3 border border-rust/40 text-rust font-body text-xs disabled:opacity-40">
          {busy ? "Undoing…" : "No-show ✓ Undo"}
        </button>
        {error && <span className="font-body text-xs text-rust" role="alert">{error}</span>}
      </span>
    );
  }

  if (asking) {
    return (
      <span className="inline-flex flex-wrap items-center gap-2" data-no-show-choice>
        <button type="button" onClick={() => mark(true)} disabled={busy} className="h-8 px-3 border border-rust text-rust font-body text-xs disabled:opacity-40">
          Charge 1 session
        </button>
        <button type="button" onClick={() => mark(false)} disabled={busy} className="h-8 px-3 border border-steel/40 text-chalk font-body text-xs disabled:opacity-40">
          Waive
        </button>
        <button type="button" onClick={() => setAsking(false)} disabled={busy} className="h-8 px-2 font-body text-xs text-steel underline underline-offset-2">
          Cancel
        </button>
        {error && <span className="w-full font-body text-xs text-rust" role="alert">{error}</span>}
      </span>
    );
  }

  return (
    <button
      type="button"
      onClick={() => setAsking(true)}
      disabled={busy}
      className="h-8 px-3 border border-steel/30 text-steel font-body text-xs active:border-rust active:text-rust transition-colors disabled:opacity-40"
    >
      Mark no-show
    </button>
  );
}
