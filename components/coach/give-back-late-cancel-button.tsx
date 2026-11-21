"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { createBrowserClient } from "@/lib/supabase/client";
import { confirmDialog } from "@/components/shared/confirm-dialog";

// "Give it back" on a charged late cancel (Ron, Nov 20, wave 2 C5): the session goes back to the client's sessions and the late cancel reads Waived. The database checks it is the
// booking's own coach (or an organization owner or admin) and that there is something to give back (give_back_late_cancel).
export function GiveBackLateCancelButton({ bookingId, who }: { bookingId: string; who: string }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const router = useRouter();

  async function giveBack() {
    if (!(await confirmDialog({ message: `Give ${who} the session back? It goes back to their sessions.`, confirmLabel: "Give it back", cancelLabel: "Keep it" }))) return;
    setBusy(true);
    setError(null);
    const { error: rpcError } = await createBrowserClient().rpc("give_back_late_cancel", { p_booking_id: bookingId });
    setBusy(false);
    if (rpcError) {
      setError("That didn't save. Nothing was changed. Try again.");
      return;
    }
    router.refresh();
  }

  return (
    <div className="mt-2 flex flex-col items-start gap-1">
      <button
        type="button"
        onClick={giveBack}
        disabled={busy}
        className="min-h-11 px-4 rounded-token-pill border border-steel/40 text-chalk font-body text-sm active:border-rust disabled:opacity-40"
        data-give-back
      >
        {busy ? "Giving it back…" : "Give it back"}
      </button>
      {error && (
        <p className="font-body text-xs text-rust-ink" role="alert">
          {error}
        </p>
      )}
    </div>
  );
}
