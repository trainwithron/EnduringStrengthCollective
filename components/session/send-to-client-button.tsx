"use client";

import { useState } from "react";

// Real gap Ron hit live: mid-way through logging a client's in-person
// session, ran out of time. The client can already resume/finish it
// themselves the moment they open their own app — WorkoutOverviewView
// already renders "Resume workout" for any existing athlete_sessions
// row regardless of who started it (lib/workout-overview-data.ts's
// existingSession check), and /sessions/[sessionId] already grants full
// edit access whenever session.athlete_id === the viewer (session_
// handoff_continue_notification_idea.md). So the only real gap is
// making the handoff low-friction instead of relying on the coach to
// remember to tell them in person — a one-tap push with a direct deep
// link into this exact session.
//
// Reuses the same POST /api/push/send + inline status-feedback pattern
// already shipped for the coach dashboard's "🔔 Notify" button
// (needs-attention-panel.tsx) rather than inventing a second one.
export function SendToClientButton({
  athleteId,
  sessionId,
  workoutTitle,
  compact = false,
}: {
  athleteId: string;
  sessionId: string;
  workoutTitle: string;
  // One small button on the header row (no row of its own) while logging; what it says after sending shows just under the header.
  compact?: boolean;
}) {
  const [status, setStatus] = useState<string | null>(null);
  const [sending, setSending] = useState(false);

  async function handleSend() {
    setSending(true);
    setStatus(null);
    try {
      const res = await fetch("/api/push/send", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          profileId: athleteId,
          title: "Finish your workout",
          body: `Your coach started logging "${workoutTitle}" with you — pick up right where they left off.`,
          url: `/sessions/${sessionId}`,
        }),
      });
      const data = await res.json();
      setStatus(data.sent > 0 ? "Sent — they'll get a direct link" : "No notifications enabled for them");
    } catch {
      setStatus("Couldn't send");
    }
    setSending(false);
  }

  if (compact) {
    return (
      <div className="shrink-0">
        <button
          type="button"
          onClick={handleSend}
          disabled={sending}
          className="h-7 px-2 border border-steel/30 text-steel font-body text-xs disabled:opacity-40 whitespace-nowrap"
          title="Send a push notification with a direct link so the client can finish logging this session themselves"
        >
          📲 Send to client
        </button>
        {status && (
          <p className="absolute right-5 top-full z-20 mt-1 bg-graphite border border-steel/30 px-2 py-1 font-body text-xs text-steel" role="status">
            {status}
          </p>
        )}
      </div>
    );
  }

  return (
    <div className="mt-2">
      <button
        type="button"
        onClick={handleSend}
        disabled={sending}
        className="h-7 px-2.5 border border-steel/30 text-steel font-body text-xs disabled:opacity-40"
        title="Send a push notification with a direct link so the client can finish logging this session themselves"
      >
        📲 Send to client to finish
      </button>
      {status && <p className="font-body text-xs text-steel mt-1">{status}</p>}
    </div>
  );
}
