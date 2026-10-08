"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { createBrowserClient } from "@/lib/supabase/client";
import { mirrorGoogleCalendarEvent } from "@/lib/mirror-google-calendar-event";

export function RescheduleSlotButton({
  bookingId,
  startAt,
  endAt,
  requestOnly = false,
}: {
  bookingId: string;
  startAt: string;
  endAt: string;
  // With self-booking off the client does not move the session themselves: they ask, the session stays where it is, and the coach confirms.
  requestOnly?: boolean;
}) {
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sent, setSent] = useState(false);
  const router = useRouter();

  async function handleRequest() {
    setSubmitting(true);
    setError(null);
    const supabase = createBrowserClient();
    const { error: rpcError } = await supabase.rpc("request_booking_move", {
      p_booking_id: bookingId,
      p_new_start_at: startAt,
      p_new_end_at: endAt,
    });
    setSubmitting(false);
    if (rpcError) {
      const msg = rpcError.message ?? "";
      setError(
        /already asked/.test(msg)
          ? "You already asked to move this session. Your coach has not answered yet."
          : /outside your coach/.test(msg)
          ? "That time is outside your coach's hours."
          : /just taken/.test(msg)
          ? "That slot was just taken. Try another."
          : "That didn't send. Nothing was changed. Try again."
      );
      router.refresh();
      return;
    }
    setSent(true);
    // Back to the normal view after a moment; the session is still at its original time until the coach confirms.
    setTimeout(() => {
      router.push(window.location.pathname);
      router.refresh();
    }, 2500);
  }

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
      setError(/outside your coach/.test(rpcError.message ?? "") ? "That time is outside your coach's hours." : "That slot was just taken. Try another.");
      setSubmitting(false);
      router.refresh();
      return;
    }

    mirrorGoogleCalendarEvent(bookingId);
    // Clears the ?reschedule= param so the page falls back to its normal
    // booking view instead of staying in reschedule mode after a move.
    router.push(window.location.pathname);
    router.refresh();
  }

  if (requestOnly) {
    return (
      <div className="flex flex-col items-end gap-1 max-w-[220px]">
        {sent ? (
          <span className="font-body text-xs text-chalk text-right">
            Sent. Your coach will confirm your new time. Your session stays where it is until then.
          </span>
        ) : (
          <button
            type="button"
            onClick={handleRequest}
            disabled={submitting}
            className="h-11 px-3 bg-rust text-graphite font-body text-xs font-medium disabled:opacity-40"
          >
            {submitting ? "Sending…" : "Ask to move here"}
          </button>
        )}
        {error && <span className="font-body text-xs text-rust text-right">{error}</span>}
      </div>
    );
  }

  return (
    <div className="flex flex-col items-end gap-1">
      <button
        type="button"
        onClick={handleMove}
        disabled={submitting}
        className="h-11 px-3 bg-rust text-graphite font-body text-xs font-medium disabled:opacity-40"
      >
        {submitting ? "Moving…" : "Move here"}
      </button>
      {error && <span className="font-body text-xs text-rust">{error}</span>}
    </div>
  );
}
