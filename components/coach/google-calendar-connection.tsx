"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { createBrowserClient } from "@/lib/supabase/client";

// Coach-only, unlike the athlete-facing wearable connection cards
// (components/athlete/google-health-connection.tsx etc.) this mirrors
// the shape of — this is a coach's own work/personal calendar split,
// not a client metric source.
export function GoogleCalendarConnection({
  groupId,
  connected,
  status,
  personalEmail,
  initialError,
}: {
  groupId: string;
  connected: boolean;
  status: "active" | "revoked" | "error" | null;
  personalEmail: string | null;
  initialError: string | null;
}) {
  const router = useRouter();
  const [disconnecting, setDisconnecting] = useState(false);
  const [error, setError] = useState(initialError);

  async function handleDisconnect() {
    setDisconnecting(true);
    setError(null);
    const supabase = createBrowserClient();
    const { error: deleteError } = await supabase.from("google_calendar_connections").delete().neq("id", "");
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
        <div>
          <span className="font-body text-sm">Google Calendar</span>
          {connected && personalEmail && (
            <p className="font-body text-[11px] text-steel">{personalEmail}</p>
          )}
        </div>
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
          <a href={`/api/google-calendar/connect?groupId=${groupId}`} className="font-body text-xs text-rust">
            Connect
          </a>
        )}
      </div>
      <p className="font-body text-xs text-steel px-3 pb-2">
        Mirrors your sessions into a dedicated work calendar and shares it back to your
        personal Google Calendar as a busy block — no session details leave this app.
      </p>
      {error && <p className="font-body text-xs text-rust px-3 pb-2">{error}</p>}
    </div>
  );
}
