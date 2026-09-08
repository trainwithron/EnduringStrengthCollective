"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { createBrowserClient } from "@/lib/supabase/client";

export function RescheduleSlotButton({
  bookingId,
  startAt,
  endAt,
}: {
  bookingId: string;
  startAt: string;
  endAt: string;
}) {
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const router = useRouter();

  async function handleMove() {
    setSubmitting(true);
    setError(null);
    const supabase = createBrowserClient();

    const { error: rpcError } = await supabase.rpc("reschedule_booking", {
      p_booking_id: bookingId,
      p_new_start_at: startAt,
      p_new_end_at: endAt,
    });

    if (rpcError) {
      setError("That slot was just taken. Try another.");
      setSubmitting(false);
      router.refresh();
      return;
    }

    // Clears the ?reschedule= param so the page falls back to its normal
    // booking view instead of staying in reschedule mode after a move.
    router.push(window.location.pathname);
    router.refresh();
  }

  return (
    <div className="flex flex-col items-end gap-1">
      <button
        type="button"
        onClick={handleMove}
        disabled={submitting}
        className="h-8 px-3 bg-rust text-graphite font-body text-xs font-medium disabled:opacity-40"
      >
        {submitting ? "Moving…" : "Move here"}
      </button>
      {error && <span className="font-body text-[11px] text-rust">{error}</span>}
    </div>
  );
}
