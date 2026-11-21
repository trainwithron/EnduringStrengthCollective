"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { createBrowserClient } from "@/lib/supabase/client";
import { notifyBookingConfirmed } from "@/lib/notify-booking-confirmed";
import { mirrorGoogleCalendarEvent } from "@/lib/mirror-google-calendar-event";
import { CANT_BOOK_NO_SESSIONS } from "@/lib/session-credit-copy";
import { bookingRefusalMessage } from "@/lib/booking-refusal-copy";
import { RecurringBookingButton } from "@/components/athlete/recurring-booking-button";

// The same day page, marked with the time just booked (any other query, such as ?client=, is kept).
export function justBookedHref(pathname: string, search: string, startAt: string): string {
  const q = new URLSearchParams(search);
  q.set("booked", startAt);
  return `${pathname}?${q.toString()}`;
}

export function BookSlotButton({
  coachId,
  athleteId,
  groupId,
  startAt,
  endAt,
  weekly = null,
}: {
  coachId: string;
  athleteId: string;
  groupId: string;
  startAt: string;
  endAt: string;
  // Booking this time every week is offered inside the confirm step (CL15, Nov 21: a "Book weekly" on every row doubled the buttons). Absent: no weekly offer.
  weekly?: { durationMinutes: number } | null;
}) {
  const [submitting, setSubmitting] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [everyWeek, setEveryWeek] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const router = useRouter();

  async function handleBook() {
    setConfirming(false);
    setSubmitting(true);
    setError(null);
    const supabase = createBrowserClient();

    // One atomic, security-definer RPC: checks a credit actually exists,
    // checks for any overlapping confirmed booking (not just an exact
    // start_at collision), inserts, then spends the credit — all in one
    // transaction, so nothing between the check and the write can race.
    const { data: bookingId, error: bookError } = await supabase.rpc("book_session", {
      p_coach_id: coachId,
      p_athlete_id: athleteId,
      p_group_id: groupId,
      p_start_at: startAt,
      p_end_at: endAt,
    });

    if (bookError) {
      setError(bookError.message.includes("no session credits") ? CANT_BOOK_NO_SESSIONS : bookingRefusalMessage(bookError.message, "Couldn't book that time. Nothing was changed. Try again."));
      setSubmitting(false);
      router.refresh();
      return;
    }

    notifyBookingConfirmed(athleteId, groupId, startAt);
    if (bookingId) mirrorGoogleCalendarEvent(bookingId);
    // Audit C7 (Nov 21): the page comes back with the row saying "You're booked for 3:00 PM" (?booked=<start>; the day pages read it).
    router.replace(justBookedHref(window.location.pathname, window.location.search, startAt), { scroll: false });
  }

  if (everyWeek && weekly) {
    return <RecurringBookingButton coachId={coachId} athleteId={athleteId} groupId={groupId} startAt={startAt} durationMinutes={weekly.durationMinutes} onCancel={() => setEveryWeek(false)} />;
  }

  // Booking spends a session credit, so a second tap confirms it.
  if (confirming && !submitting) {
    return (
      <div className="flex flex-col items-end gap-1.5">
        <span className="font-body text-xs text-chalk">Book this time? Uses 1 session.</span>
        {weekly && (
          <button type="button" onClick={() => setEveryWeek(true)} className="min-h-11 px-1 font-body text-xs text-rust-ink" data-book-every-week>
            Make it every week →
          </button>
        )}
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => setConfirming(false)}
            className="h-11 px-4 border border-steel/30 text-steel font-body text-sm"
          >
            Not now
          </button>
          <button
            type="button"
            onClick={handleBook}
            className="h-11 px-4 bg-rust text-graphite font-body text-sm font-medium"
          >
            Confirm
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col items-end gap-1">
      <button
        type="button"
        onClick={() => setConfirming(true)}
        disabled={submitting}
        className="h-11 px-4 bg-rust text-graphite font-body text-sm font-medium disabled:opacity-40"
      >
        {submitting ? "Booking…" : "Book"}
      </button>
      {error && <span className="font-body text-xs text-rust-ink">{error}</span>}
    </div>
  );
}
