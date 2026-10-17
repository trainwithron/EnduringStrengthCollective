"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { createBrowserClient } from "@/lib/supabase/client";

// Accept or decline a coach's invitation to be their one-on-one client. The database function only lets the invited person answer.
export function SpaceInviteAnswer({ inviteId }: { inviteId: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function answer(accept: boolean) {
    setBusy(true);
    setError(null);
    const { data, error: rpcError } = await createBrowserClient({ crossOrg: true }).rpc("answer_space_invite", { p_invite: inviteId, p_accept: accept });
    setBusy(false);
    if (rpcError) {
      setError(rpcError.message);
      return;
    }
    router.push(accept && typeof data === "string" ? `/groups/${data}` : "/");
    router.refresh();
  }

  return (
    <div className="mt-6 flex flex-col gap-2">
      {error && (
        <p className="font-body text-sm text-rust" role="alert">
          {error}
        </p>
      )}
      <button type="button" disabled={busy} onClick={() => answer(true)} className="min-h-11 bg-rust text-graphite font-display font-bold uppercase tracking-wide px-4 py-2 disabled:opacity-40">
        {busy ? "Saving…" : "Accept"}
      </button>
      <button type="button" disabled={busy} onClick={() => answer(false)} className="min-h-11 font-body text-sm text-steel">
        No thanks
      </button>
    </div>
  );
}
