"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { createBrowserClient } from "@/lib/supabase/client";
import { GiveBackLateCancelButton } from "@/components/coach/give-back-late-cancel-button";

// What the coach can still do with a session the client cancelled (Ron, Nov 21), the same actions as on Requests: a late cancel waiting for them is Charged (takes one session)
// or Waived (takes none) through resolve_late_change; a charged one can be given back (give_back_late_cancel). Nothing to do for one cancelled in time or already waived.
export function CanceledSessionActions({
  bookingId,
  lateState,
  canGiveBack,
  name,
}: {
  bookingId: string;
  lateState: "charged" | "waived" | "flagged" | null;
  // only a charged late cancel can be given back (give_back_late_cancel refuses a charged late move that was cancelled afterwards)
  canGiveBack: boolean;
  name: string;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const router = useRouter();
  const first = name.split(" ")[0] || "them";

  async function decide(charge: boolean) {
    if (busy) return;
    setBusy(true);
    setError(null);
    const { error: rpcError } = await createBrowserClient().rpc("resolve_late_change", { p_booking_id: bookingId, p_charge: charge });
    setBusy(false);
    if (rpcError) {
      setError("That didn't save. Nothing was changed. Try again.");
      return;
    }
    router.refresh();
  }

  if (lateState === "charged") return canGiveBack ? <GiveBackLateCancelButton bookingId={bookingId} who={first} /> : null;
  if (lateState !== "flagged") return null;
  return (
    <div className="mt-2 flex flex-col items-start gap-1">
      <div className="flex items-center gap-2">
        <button type="button" disabled={busy} onClick={() => void decide(true)} className="h-11 px-4 border border-rust text-rust-ink font-body text-sm disabled:opacity-50">
          Charge
        </button>
        <button type="button" disabled={busy} onClick={() => void decide(false)} className="h-11 px-4 border border-steel/30 text-chalk font-body text-sm disabled:opacity-50">
          Waive
        </button>
      </div>
      <p className="font-body text-xs text-steel">Charge takes one of {first}&apos;s sessions; Waive takes none.</p>
      {error && (
        <p className="font-body text-xs text-rust-ink" role="alert">
          {error}
        </p>
      )}
    </div>
  );
}
