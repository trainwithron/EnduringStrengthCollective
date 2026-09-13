"use client";

import { useState } from "react";

// Daily.co Prebuilt embed — a full-screen iframe with its own call UI
// (device pickers, participant grid, reconnection states) built in, so
// this component only has to fetch a room URL + token and hand off to
// it. Loaded dynamically so the ~daily-js bundle never ships to a page
// that never opens a call.
export function VideoCallButton({ bookingId }: { bookingId: string }) {
  const [loading, setLoading] = useState(false);
  const [inCall, setInCall] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleJoin() {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/bookings/${bookingId}/video-room`, { method: "POST" });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error ?? "Couldn't join the call.");
        setLoading(false);
        return;
      }

      const { default: DailyIframe } = await import("@daily-co/daily-js");
      const frame = DailyIframe.createFrame({
        showLeaveButton: true,
        iframeStyle: {
          position: "fixed",
          inset: "0",
          width: "100%",
          height: "100%",
          zIndex: "999",
        },
      });
      frame.on("left-meeting", () => {
        frame.destroy();
        setInCall(false);
      });
      await frame.join({ url: data.url, token: data.token });
      setInCall(true);
    } catch {
      setError("Couldn't join the call — try again.");
    } finally {
      setLoading(false);
    }
  }

  if (inCall) return null;

  return (
    <div>
      <button
        type="button"
        onClick={handleJoin}
        disabled={loading}
        className="h-8 px-3 bg-rust text-graphite font-body text-xs font-medium disabled:opacity-40"
      >
        {loading ? "Connecting…" : "🎥 Join call"}
      </button>
      {error && (
        <p className="font-body text-xs text-rust mt-1" role="alert">
          {error}
        </p>
      )}
    </div>
  );
}
