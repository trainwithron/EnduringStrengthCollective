"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { createBrowserClient } from "@/lib/supabase/client";

// "Wing it": a coach logging a client who came in with no program (or not today's program) starts an empty workout and types what they do as they go (components/logging/wing-it-box.tsx).
// A wing-it workout already open for this client today is picked up again, never a second one made. Nothing is booked and no session is used here: that is the walk-in prompt when the
// workout is completed (FIX 3).
export function WingItStartButton({
  groupId,
  athleteId,
  label = "Wing it",
  variant = "primary",
}: {
  groupId: string;
  athleteId: string;
  label?: string;
  variant?: "primary" | "secondary";
}) {
  const router = useRouter();
  const [starting, setStarting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function start() {
    if (starting) return;
    setStarting(true);
    setError(null);
    const supabase = createBrowserClient();
    // Today on this device: a wing-it workout (no program, logged by a coach) still open since midnight is the same visit.
    const midnight = new Date();
    midnight.setHours(0, 0, 0, 0);
    const { data: open } = await supabase
      .from("athlete_sessions")
      .select("id")
      .eq("athlete_id", athleteId)
      .eq("group_id", groupId)
      .eq("status", "in_progress")
      .eq("logged_by_coach", true)
      .is("workout_id", null)
      .gte("started_at", midnight.toISOString())
      .order("started_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (open?.id) {
      router.push(`/sessions/${open.id}`);
      return;
    }
    const { data: sessionId, error: rpcError } = await supabase.rpc("start_workout_session", {
      p_workout_id: null,
      p_group_id: groupId,
      p_athlete_id: athleteId,
      p_logged_by_coach: true,
      p_session_type_id: null,
      p_deduct_session_credit: false,
      p_booking_id: null,
      p_exercises: [],
    });
    if (rpcError || !sessionId) {
      setStarting(false);
      setError("Couldn't start the workout — check your connection and try again.");
      return;
    }
    router.push(`/sessions/${sessionId}`);
  }

  return (
    <div>
      <button
        type="button"
        onClick={start}
        disabled={starting}
        className={
          variant === "primary"
            ? "w-full min-h-14 flex items-center justify-center bg-rust text-graphite font-display uppercase text-lg font-bold text-center px-3 disabled:opacity-50"
            : "w-full min-h-11 flex items-center justify-center border border-steel/40 text-chalk font-body text-sm text-center px-3 disabled:opacity-50"
        }
      >
        {starting ? "Starting…" : label}
      </button>
      {error && (
        <p className="font-body text-xs text-rust mt-2" role="alert">
          {error}
        </p>
      )}
    </div>
  );
}
