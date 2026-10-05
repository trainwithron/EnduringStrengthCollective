"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { createBrowserClient } from "@/lib/supabase/client";

export type CreditState = "prepaid" | "unsettled" | "settled" | "waived";

// One tap on a calendar booking: the session happened. An unsettled booking (one the coach scheduled) takes one
// session from the client's balance, which may go below zero (the coach sees "Owed N"); a prepaid one (the client
// booked and already paid with a credit) is only marked attended. Settling twice is impossible on the database side,
// and there is an Undo. "Don't charge" waives an unsettled session (a holiday, a make-good).
export function MarkAttendedControl({
  bookingId,
  initialAttended,
  initialState,
}: {
  bookingId: string;
  initialAttended: boolean;
  initialState: CreditState;
}) {
  const [attended, setAttended] = useState(initialAttended);
  const [state, setState] = useState<CreditState>(initialState);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const router = useRouter();

  async function run(fn: "mark_booking_attended" | "undo_booking_attended" | "waive_booking") {
    setBusy(true);
    setError(null);
    const supabase = createBrowserClient();
    const { error: rpcError } = await supabase.rpc(fn, fn === "waive_booking" ? { p_booking_id: bookingId, p_note: null } : { p_booking_id: bookingId });
    setBusy(false);
    if (rpcError) {
      setError("That didn't save.");
      return;
    }
    if (fn === "mark_booking_attended") {
      setAttended(true);
      if (state === "unsettled") setState("settled");
    } else if (fn === "undo_booking_attended") {
      setAttended(false);
      if (state === "settled") setState("unsettled");
    } else {
      setState("waived");
    }
    router.refresh();
  }

  if (attended) {
    return (
      <span className="flex items-center gap-2">
        <span className="font-body text-xs text-steel">
          Attended{state === "settled" ? " (1 session used)" : state === "prepaid" ? " (prepaid)" : ""}
        </span>
        <button
          type="button"
          onClick={() => run("undo_booking_attended")}
          disabled={busy}
          className="h-8 px-3 border border-steel/30 text-steel font-body text-xs disabled:opacity-40"
        >
          {busy ? "Undoing…" : "Undo"}
        </button>
        {error && <span className="font-body text-xs text-rust">{error}</span>}
      </span>
    );
  }

  if (state === "waived") {
    return <span className="font-body text-xs text-steel">Not charged</span>;
  }

  return (
    <span className="flex items-center gap-2">
      <button
        type="button"
        onClick={() => run("mark_booking_attended")}
        disabled={busy}
        className="h-8 px-3 border border-rust/50 text-rust font-body text-xs disabled:opacity-40"
      >
        {busy ? "Saving…" : "Mark attended"}
      </button>
      {state === "unsettled" && (
        <button
          type="button"
          onClick={() => run("waive_booking")}
          disabled={busy}
          className="h-8 px-3 border border-steel/30 text-steel font-body text-xs disabled:opacity-40"
        >
          Don&apos;t charge
        </button>
      )}
      {error && <span className="font-body text-xs text-rust">{error}</span>}
    </span>
  );
}
