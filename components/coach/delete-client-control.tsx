"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { runDeleteClient } from "@/components/coach/delete-client-flow";

// The coach's way to delete a client completely, from the client's profile. Removing someone from a group only takes them out of that group; this erases the account. The confirm is the same in-page
// dialog the client card's menu uses (components/coach/delete-client-flow.ts), so there is one flow.
export function DeleteClientControl({ groupId, athleteId, athleteName }: { groupId: string; athleteId: string; athleteName: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function start() {
    if (busy) return;
    setError(null);
    setBusy(true);
    const result = await runDeleteClient({ groupId, athleteId, athleteName });
    setBusy(false);
    if (result.status === "failed") {
      setError(result.error);
      return;
    }
    if (result.status === "deleted") {
      // A one-on-one space that held only this client is gone too, so there is no page to come back to.
      router.push(result.spaceGone ? "/dashboard" : `/groups/${groupId}/clients`);
      router.refresh();
    }
  }

  return (
    <div>
      <h2 className="font-display uppercase text-sm tracking-wide text-steel mb-1">Delete client</h2>
      <p className="font-body text-xs text-steel mb-2 max-w-[60ch]">
        Removing someone from a group only takes them out of that group. Delete erases {athleteName}&apos;s account completely. Payment records are kept, with no name on them.
      </p>
      <button type="button" onClick={() => void start()} disabled={busy} className="min-h-11 font-body text-sm text-rust underline underline-offset-2 disabled:opacity-40">
        {busy ? "Deleting…" : `Delete ${athleteName}…`}
      </button>
      {error && (
        <p className="font-body text-xs text-rust mt-2 max-w-[60ch]" role="alert">
          {error}
        </p>
      )}
    </div>
  );
}
