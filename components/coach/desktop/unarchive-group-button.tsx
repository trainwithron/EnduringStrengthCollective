"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { createBrowserClient } from "@/lib/supabase/client";

// Brings a retired season back into the coach's lists.
export function UnarchiveGroupButton({ groupId }: { groupId: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function bringBack() {
    setBusy(true);
    setError(null);
    const { error: rpcError } = await createBrowserClient().rpc("unarchive_group", { p_group: groupId });
    setBusy(false);
    if (rpcError) {
      setError(rpcError.message);
      return;
    }
    router.refresh();
  }

  return (
    <span>
      <button type="button" onClick={bringBack} disabled={busy} className="font-body text-xs text-rust underline disabled:opacity-40">
        {busy ? "Bringing it back…" : "Bring it back"}
      </button>
      {error && (
        <span className="font-body text-xs text-rust ml-2" role="alert">
          {error}
        </span>
      )}
    </span>
  );
}
