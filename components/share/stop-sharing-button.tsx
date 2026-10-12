"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { createBrowserClient } from "@/lib/supabase/client";
import { confirmDialog } from "@/components/shared/confirm-dialog";

// For the client who made the card, on their own card only: takes the card down. The card row is deleted, so the link stops working for everyone ("This card isn't available").
export function StopSharingButton({ cardId }: { cardId: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function stop() {
    if (!(await confirmDialog({ message: "Stop sharing this card? The link will stop working for everyone. You can make a new card any time.", confirmLabel: "Stop sharing" }))) return;
    setBusy(true);
    setError(null);
    const { error: deleteError } = await createBrowserClient().from("transformation_cards").delete().eq("id", cardId);
    setBusy(false);
    if (deleteError) {
      setError("That didn't work. The card is still shared. Try again.");
      return;
    }
    router.refresh();
  }

  return (
    <div className="mt-4">
      {error && (
        <p className="font-body text-xs text-rust mb-1" role="alert">
          {error}
        </p>
      )}
      <button type="button" disabled={busy} onClick={stop} className="min-h-11 px-4 font-body text-sm text-steel underline underline-offset-2 disabled:opacity-40">
        {busy ? "Stopping…" : "Stop sharing"}
      </button>
    </div>
  );
}
