"use client";

import { useRef, useState } from "react";
import { QuietHoursNotice } from "@/components/athlete/quiet-hours-notice";
import { useRouter } from "next/navigation";
import { createBrowserClient } from "@/lib/supabase/client";
import { mirrorGoogleCalendarEvent } from "@/lib/mirror-google-calendar-event";
import { bookingRefusalMessage } from "@/lib/booking-refusal-copy";

// How long the "Sent" line stays before the calendar comes back: a moment, or long enough to read the coach's quiet-hours line when it shows.
export const BACK_AFTER_MS = 2500;
export const BACK_AFTER_QUIET_MS = 6000;

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
  // the coach's quiet-hours line is showing: the screen waits longer before going back, and offers to go now
  const [holding, setHolding] = useState(false);
  const backTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const router = useRouter();

  function backToCalendar() {
    if (backTimer.current) clearTimeout(backTimer.current);
    backTimer.current = null;
    router.push(window.location.pathname);
    router.refresh();
  }
  function backAfter(ms: number) {
    if (backTimer.current) clearTimeout(backTimer.current);
    backTimer.current = setTimeout(backToCalendar, ms);
  }

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
      setError(bookingRefusalMessage(rpcError.message, "That didn't send. Nothing was changed. Try again."));
      router.refresh();
      return;
    }
    setSent(true);
    // Back to the normal view after a moment; the session is still at its original time until the coach confirms. When the coach's quiet-hours line shows, the wait is
    // longer so it can be read, with a button to go back sooner (QuietHoursNotice onLine below).
    backAfter(BACK_AFTER_MS);
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
      setError(bookingRefusalMessage(rpcError.message));
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
            <QuietHoursNotice
              bookingId={bookingId}
              className="mt-1 text-xs"
              onLine={(line) => {
                if (!line) return;
                setHolding(true);
                backAfter(BACK_AFTER_QUIET_MS);
              }}
            />
            {holding && (
              <button type="button" onClick={backToCalendar} className="mt-2 min-h-11 px-4 rounded-token-pill border border-steel/40 text-chalk font-body text-xs">
                Back to calendar
              </button>
            )}
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
        {error && <span className="font-body text-xs text-rust-ink text-right">{error}</span>}
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
      {error && <span className="font-body text-xs text-rust-ink">{error}</span>}
    </div>
  );
}
