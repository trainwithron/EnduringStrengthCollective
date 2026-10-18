"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { runDeleteClient, runRemoveClient } from "@/components/coach/delete-client-flow";

// The coach's way to take a client out of their clients, from the client's profile: "Remove from my clients" (kept, can be put back) or "Delete permanently" (30 days to undo, then the account is erased). The confirms are
// the same in-page dialogs the client card's menu uses (components/coach/delete-client-flow.ts), so there is one flow.
export function DeleteClientControl({ groupId, athleteId, athleteName }: { groupId: string; athleteId: string; athleteName: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function remove() {
    if (busy) return;
    setError(null);
    setBusy(true);
    const result = await runRemoveClient({ groupId, athleteId, athleteName });
    setBusy(false);
    if (result.status === "failed") {
      setError(result.error);
      return;
    }
    if (result.status === "removed") {
      router.push(`/groups/${groupId}/clients`);
      router.refresh();
    }
  }

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
      router.push(`/groups/${groupId}/clients`);
      router.refresh();
    }
  }

  return (
    <div>
      <h2 className="font-display uppercase text-sm tracking-wide text-steel mb-1">Remove or delete client</h2>
      <p className="font-body text-xs text-steel mb-2 max-w-[60ch]">
        Remove takes {athleteName} out of your clients but keeps their account and everything about them; you can put them back any time. Delete permanently does the same, then erases the account after 30 days unless you put them back. Payment records are kept, with no name on them.
      </p>
      <div className="flex flex-wrap gap-x-6">
        <button type="button" onClick={() => void remove()} disabled={busy} className="min-h-11 font-body text-sm text-chalk underline underline-offset-2 disabled:opacity-40">
          {busy ? "Working…" : `Remove ${athleteName} from my clients…`}
        </button>
        <button type="button" onClick={() => void start()} disabled={busy} className="min-h-11 font-body text-sm text-rust underline underline-offset-2 disabled:opacity-40">
          {busy ? "Working…" : `Delete ${athleteName} permanently…`}
        </button>
      </div>
      {error && (
        <p className="font-body text-xs text-rust mt-2 max-w-[60ch]" role="alert">
          {error}
        </p>
      )}
    </div>
  );
}
