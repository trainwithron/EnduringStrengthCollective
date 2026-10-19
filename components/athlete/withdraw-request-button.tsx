"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { createBrowserClient } from "@/lib/supabase/client";

// A client takes back a request they made and the coach has not answered yet (the database function cancel_booking_request already exists and is the client's own). Without this a request could only wait, and a few
// stale ones locked a client out of asking again (Oct 19 audit).
export function WithdrawRequestButton({ requestId }: { requestId: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function withdraw() {
    if (busy) return;
    setBusy(true);
    setError(null);
    const { error: rpcError } = await createBrowserClient().rpc("cancel_booking_request", { p_request_id: requestId });
    setBusy(false);
    if (rpcError) {
      setError(/already answered/i.test(rpcError.message) ? "Your coach already answered this one." : "Couldn't withdraw it. Try again.");
      router.refresh();
      return;
    }
    router.refresh();
  }

  return (
    <span className="inline-flex flex-col items-start">
      <button type="button" onClick={() => void withdraw()} disabled={busy} className="h-11 px-3 border border-steel/30 text-steel font-body text-xs active:border-rust active:text-rust disabled:opacity-40">
        {busy ? "Withdrawing…" : "Withdraw"}
      </button>
      {error && (
        <span className="font-body text-xs text-rust" role="alert">
          {error}
        </span>
      )}
    </span>
  );
}
