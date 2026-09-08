"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { createBrowserClient } from "@/lib/supabase/client";

export function AssignSlotButton({
  coachId,
  athleteId,
  groupId,
  startAt,
  endAt,
}: {
  coachId: string;
  athleteId: string;
  groupId: string;
  startAt: string;
  endAt: string;
}) {
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const router = useRouter();

  async function handleAssign() {
    setSubmitting(true);
    setError(null);
    const supabase = createBrowserClient();

    // Same partial unique index on (coach_id, start_at) guards against
    // double-booking here as it does on the athlete's own self-book flow.
    const { error: insertError } = await supabase.from("bookings").insert({
      coach_id: coachId,
      athlete_id: athleteId,
      group_id: groupId,
      start_at: startAt,
      end_at: endAt,
    });

    if (insertError) {
      setError("That slot was just taken. Try another.");
      setSubmitting(false);
      router.refresh();
      return;
    }

    // Atomic DB-side decrement — see book-slot-button.tsx for why this
    // isn't a read-then-write anymore.
    await supabase.rpc("adjust_session_credits", {
      p_athlete_id: athleteId,
      p_group_id: groupId,
      p_delta: -1,
    });

    router.refresh();
  }

  return (
    <div className="flex flex-col items-end gap-1">
      <button
        type="button"
        onClick={handleAssign}
        disabled={submitting}
        className="h-8 px-3 bg-rust text-graphite font-body text-xs font-medium disabled:opacity-40"
      >
        {submitting ? "Assigning…" : "Assign"}
      </button>
      {error && <span className="font-body text-[11px] text-rust">{error}</span>}
    </div>
  );
}
