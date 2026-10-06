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
  viewer = "client",
  insideWindowHours,
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
  // The coach cancels differently from a client: there is no balance to mention, and a session that belongs to a weekly schedule is
  // taken off the schedule (skipped) so the nightly top-up does not book it again.
  viewer?: "coach" | "client";
  // Set when the client is inside the coach's cancellation window, so the confirm can say it will still count.
  insideWindowHours?: number | null;
}) {
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [cancellingSeries, setCancellingSeries] = useState(false);
  const router = useRouter();

  async function handleCancel() {
    const message =
      viewer === "coach"
        ? "Cancel this session? Anything charged for it is given back."
        : insideWindowHours
        ? `This is inside your coach's ${insideWindowHours}-hour window. Your coach will be told and decides whether it counts as a session. Cancel anyway?`
        : "Cancel this session? If it is outside your coach's cancellation window it goes back to your balance.";
    if (!window.confirm(message)) return;
    setSubmitting(true);
    setError(null);

    if (viewer === "coach" && recurringSeriesId) {
      const res = await fetch("/api/series/occurrence", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ bookingId, action: "skip" }),
      });
      const data = await res.json().catch(() => ({}));
      setSubmitting(false);
      if (!res.ok) {
        setError(data.message ?? data.error ?? "That didn't cancel. Nothing was changed.");
        return;
      }
      router.refresh();
      return;
    }

    const supabase = createBrowserClient();

    // One atomic, self-verifying RPC — checks server-side that a real
    // 'confirmed' booking belonging to this athlete (or their coach)
    // actually exists before flipping it to cancelled and refunding a
    // credit, rather than two separate client-driven steps (which used
    // to let adjust_session_credits be called with a bare +1 and no real
    // cancellation behind it at all).
    const { error: cancelError } = await supabase.rpc("cancel_booking_and_refund_credit", { p_booking_id: bookingId });
    if (cancelError) {
      setSubmitting(false);
      setError("That didn't cancel. Nothing was changed. Try again.");
      return;
    }

    mirrorGoogleCalendarEvent(bookingId);
    setSubmitting(false);
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
            className="h-11 px-3 flex items-center border border-steel/30 text-steel font-body text-xs active:border-rust active:text-rust transition-colors"
          >
            Reschedule
          </Link>
        )}
        <button
          type="button"
          onClick={handleCancel}
          disabled={submitting}
          className="h-11 px-3 border border-steel/30 text-steel font-body text-xs active:border-rust active:text-rust transition-colors disabled:opacity-40"
        >
          {submitting ? "Cancelling…" : viewer === "coach" ? "Cancel" : "Booked ✓ Cancel"}
        </button>
      </div>
      {error && (
        <p className="font-body text-xs text-rust max-w-[220px] text-right" role="alert">
          {error}
        </p>
      )}
      {recurringSeriesId && (
        <button
          type="button"
          onClick={handleCancelSeries}
          disabled={cancellingSeries}
          className="font-body text-xs text-rust disabled:opacity-40"
        >
          {cancellingSeries ? "Cancelling series…" : "Cancel entire series"}
        </button>
      )}
    </div>
  );
}
