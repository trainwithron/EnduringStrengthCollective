"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { createBrowserClient } from "@/lib/supabase/client";

// workout_logger_hard_exit_scoping_sept19.md — closes a real state-
// hygiene gap: leaving a session mid-workout today just silently leaves
// the row `in_progress` forever, with no formal closure. Sets already
// entered stay saved regardless of how a session ends
// (complete-workout-button.tsx's own copy already says as much) — this
// isn't a data-loss fix, it's giving the session a real terminal state
// using the `abandoned` value session_status has always had, never
// written anywhere until now.
export function ExitWorkoutButton({ sessionId, backHref }: { sessionId: string; backHref: string }) {
  const router = useRouter();
  const [confirming, setConfirming] = useState(false);
  const [exiting, setExiting] = useState(false);

  async function handleExit() {
    setExiting(true);
    const supabase = createBrowserClient();
    await supabase.from("athlete_sessions").update({ status: "abandoned" }).eq("id", sessionId);
    router.push(backHref);
  }

  if (confirming) {
    return (
      <div className="border border-rust/40 bg-surface/60 p-3 mt-1">
        <p className="font-body text-xs text-chalk mb-2">
          Exit this workout? Everything you&apos;ve already logged is saved either way.
        </p>
        <div className="flex items-center gap-3">
          <button
            type="button"
            onClick={handleExit}
            disabled={exiting}
            className="h-8 px-3 bg-rust text-graphite font-body text-xs font-medium disabled:opacity-40"
          >
            {exiting ? "Exiting…" : "Exit workout"}
          </button>
          <button
            type="button"
            onClick={() => setConfirming(false)}
            disabled={exiting}
            className="h-8 px-3 border border-steel/30 text-steel font-body text-xs"
          >
            Keep going
          </button>
        </div>
      </div>
    );
  }

  return (
    <button
      type="button"
      onClick={() => setConfirming(true)}
      className="font-body text-xs text-steel uppercase tracking-wide active:text-rust"
    >
      &larr; Exit workout
    </button>
  );
}
