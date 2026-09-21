"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { createBrowserClient } from "@/lib/supabase/client";
import { mirrorGoogleCalendarEvent } from "@/lib/mirror-google-calendar-event";

export function CancelBookingButton({
  bookingId,
  rescheduleHref,
  recurringSeriesId,
}: {
  bookingId: string;
  // When provided, links to the same day-detail page in "move this
  // booking" mode (?reschedule=<bookingId>) so the athlete can pick a new
  // open slot instead of cancelling outright. Omitted from contexts where
  // there's no natural page to reschedule from.
  rescheduleHref?: string;
  // acuity_replacement_gap_audit_sept16.md — only set when this
  // occurrence belongs to a real recurring series. Cancelling just this
  // one occurrence is the default "Cancel" button's existing behavior,
  // unchanged; the whole series is a separate, explicit action, never a
  // side effect of the single-occurrence cancel.
  recurringSeriesId?: string | null;
}) {
  const [submitting, setSubmitting] = useState(false);
  const [cancellingSeries, setCancellingSeries] = useState(false);
  const router = useRouter();

  async function handleCancel() {
    setSubmitting(true);
    const supabase = createBrowserClient();

    // One atomic, self-verifying RPC — checks server-side that a real
    // 'confirmed' booking belonging to this athlete (or their coach)
    // actually exists before flipping it to cancelled and refunding a
    // credit, rather than two separate client-driven steps (which used
    // to let adjust_session_credits be called with a bare +1 and no real
    // cancellation behind it at all).
    await supabase.rpc("cancel_booking_and_refund_credit", { p_booking_id: bookingId });

    mirrorGoogleCalendarEvent(bookingId);
    router.refresh();
  }

  async function handleCancelSeries() {
    if (!recurringSeriesId) return;
    if (!window.confirm("Cancel every remaining session in this weekly series?")) return;
    setCancellingSeries(true);
    const supabase = createBrowserClient();
    await supabase.rpc("cancel_recurring_booking_series", { p_series_id: recurringSeriesId });
    setCancellingSeries(false);
    router.refresh();
  }

  return (
    <div className="flex flex-col items-end gap-1">
      <div className="flex items-center gap-2">
        {rescheduleHref && (
          <Link
            href={rescheduleHref}
            className="h-8 px-3 flex items-center border border-steel/30 text-steel font-body text-xs active:border-rust active:text-rust transition-colors"
          >
            Reschedule
          </Link>
        )}
        <button
          type="button"
          onClick={handleCancel}
          disabled={submitting}
          className="h-8 px-3 border border-steel/30 text-steel font-body text-xs active:border-rust active:text-rust transition-colors disabled:opacity-40"
        >
          {submitting ? "Cancelling…" : "Booked ✓ Cancel"}
        </button>
      </div>
      {recurringSeriesId && (
        <button
          type="button"
          onClick={handleCancelSeries}
          disabled={cancellingSeries}
          className="font-body text-[11px] text-rust disabled:opacity-40"
        >
          {cancellingSeries ? "Cancelling series…" : "Cancel entire series"}
        </button>
      )}
    </div>
  );
}
