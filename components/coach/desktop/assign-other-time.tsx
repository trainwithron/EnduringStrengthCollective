"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { createBrowserClient } from "@/lib/supabase/client";
import { zonedTimeToUtc } from "@/lib/timezone";
import { notifyBookingConfirmed } from "@/lib/notify-booking-confirmed";
import { mirrorGoogleCalendarEvent } from "@/lib/mirror-google-calendar-event";

// Next to the open slots when a coach is scheduling a client: book at any time in 5-minute steps and any length (Ron, Oct 6: "we can be human with one
// another"). The slots are a convenience, not a rule: this books through the same book_session call, and only warns when the time is outside the coach's
// open hours, because the coach decides.
export function AssignOtherTime({
  coachId,
  athleteId,
  groupId,
  dateKey,
  timezone,
  defaultMinutes,
  openRanges,
  busyRanges,
}: {
  coachId: string;
  athleteId: string;
  groupId: string;
  dateKey: string;
  timezone: string;
  defaultMinutes: number;
  // The coach's open hours that day, as [start, end] instants (ms).
  openRanges: { startMs: number; endMs: number }[];
  // Sessions already booked that day, as [start, end] instants (ms).
  busyRanges: { startMs: number; endMs: number }[];
}) {
  const [time, setTime] = useState("");
  const [minutes, setMinutes] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const router = useRouter();

  const length = minutes.trim() === "" ? defaultMinutes : Number(minutes);
  const valid = /^\d{2}:\d{2}$/.test(time) && Number.isInteger(length) && length >= 5 && length <= 480;
  const start = valid ? zonedTimeToUtc(dateKey, time, timezone) : null;
  const end = start ? new Date(start.getTime() + length * 60000) : null;
  const clash = !!(start && end && busyRanges.some((b) => b.startMs < end.getTime() && b.endMs > start.getTime()));
  const outside = !!(start && end && !openRanges.some((o) => o.startMs <= start.getTime() && end.getTime() <= o.endMs));

  async function book() {
    if (!start || !end) return;
    setSubmitting(true);
    setError(null);
    const { data: bookingId, error: bookError } = await createBrowserClient().rpc("book_session", {
      p_coach_id: coachId,
      p_athlete_id: athleteId,
      p_group_id: groupId,
      p_start_at: start.toISOString(),
      p_end_at: end.toISOString(),
    });
    setSubmitting(false);
    if (bookError) {
      setError(bookError.message.includes("just taken") ? "That time overlaps another session." : "Couldn't book that time.");
      router.refresh();
      return;
    }
    notifyBookingConfirmed(athleteId, groupId, start.toISOString());
    if (bookingId) mirrorGoogleCalendarEvent(bookingId);
    setTime("");
    setMinutes("");
    router.refresh();
  }

  return (
    <div className="mt-6 max-w-lg border border-steel/20 p-3">
      <h2 className="font-display uppercase text-sm tracking-wide text-steel mb-2">Another time</h2>
      <div className="flex flex-wrap items-end gap-3">
        <label className="font-body text-xs text-steel">
          Start
          <input
            type="time"
            step={300}
            value={time}
            onChange={(e) => setTime(e.target.value)}
            className="mt-1 block h-10 bg-graphite border border-steel/30 text-chalk px-2 font-body text-sm"
          />
        </label>
        <label className="font-body text-xs text-steel">
          Minutes
          <input
            type="number"
            min={5}
            max={480}
            step={5}
            value={minutes}
            placeholder={String(defaultMinutes)}
            onChange={(e) => setMinutes(e.target.value)}
            className="mt-1 block w-24 h-10 bg-graphite border border-steel/30 text-chalk px-2 font-body text-sm"
          />
        </label>
        <button
          type="button"
          onClick={book}
          disabled={!valid || clash || submitting}
          className="h-10 px-4 bg-rust text-graphite font-body text-sm font-medium disabled:opacity-40"
        >
          {submitting ? "Booking…" : "Book this time"}
        </button>
      </div>
      {valid && outside && !clash && <p className="font-body text-xs text-steel mt-2">This is outside your open hours. You can still book it.</p>}
      {clash && <p className="font-body text-xs text-rust mt-2">That overlaps another session on this day.</p>}
      {error && (
        <p className="font-body text-xs text-rust mt-2" role="alert">
          {error}
        </p>
      )}
    </div>
  );
}
