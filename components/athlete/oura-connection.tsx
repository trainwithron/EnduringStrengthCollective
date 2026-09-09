"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { createBrowserClient } from "@/lib/supabase/client";

export function OuraConnection({
  groupId,
  connected,
  status,
  initialError,
}: {
  groupId: string;
  connected: boolean;
  status: "active" | "revoked" | "error" | null;
  initialError: string | null;
}) {
  const router = useRouter();
  const [disconnecting, setDisconnecting] = useState(false);
  const [error, setError] = useState(initialError);

  async function handleDisconnect() {
    setDisconnecting(true);
    setError(null);
    const supabase = createBrowserClient();
    const { error: deleteError } = await supabase
      .from("wearable_connections")
      .delete()
      .eq("provider", "oura");
    setDisconnecting(false);
    if (deleteError) {
      setError("Couldn't disconnect — try again.");
      return;
    }
    router.refresh();
  }

  return (
    <div className="border border-steel/15">
      <div className="flex items-center justify-between h-10 px-3">
        <span className="font-body text-sm">Oura</span>
        {connected ? (
          <div className="flex items-center gap-3">
            <span className="font-body text-[11px] text-steel uppercase tracking-wide">
              {status === "error" ? "Reconnect needed" : "Connected"}
            </span>
            <button
              onClick={handleDisconnect}
              disabled={disconnecting}
              className="font-body text-xs text-rust disabled:opacity-40"
            >
              {disconnecting ? "Disconnecting…" : "Disconnect"}
            </button>
          </div>
        ) : (
          <a href={`/api/oura/connect?groupId=${groupId}`} className="font-body text-xs text-rust">
            Connect
          </a>
        )}
      </div>
      {error && <p className="font-body text-xs text-rust px-3 pb-2">{error}</p>}
    </div>
  );
}
