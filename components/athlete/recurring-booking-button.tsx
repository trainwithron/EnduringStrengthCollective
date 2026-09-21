"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { createBrowserClient } from "@/lib/supabase/client";

// acuity_replacement_gap_audit_sept16.md — recurring bookings, capped
// at 12 occurrences (per Ron's own confirmed answer). Reuses
// create_recurring_booking_series, which itself reuses book_session's
// entire safety net per occurrence — this is just the UI entry point
// next to the existing single-slot "Book" button, not a replacement
// for it.
export function RecurringBookingButton({
  coachId,
  athleteId,
  groupId,
  startAt,
  durationMinutes,
}: {
  coachId: string;
  athleteId: string;
  groupId: string;
  startAt: string;
  durationMinutes: number;
}) {
  const [open, setOpen] = useState(false);
  const [occurrences, setOccurrences] = useState(4);
  const [submitting, setSubmitting] = useState(false);
  const [result, setResult] = useState<{ booked: number; failed: number } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const router = useRouter();

  async function handleCreate() {
    setSubmitting(true);
    setError(null);
    const supabase = createBrowserClient();
    const { data, error: createError } = await supabase
      .rpc("create_recurring_booking_series", {
        p_coach_id: coachId,
        p_athlete_id: athleteId,
        p_group_id: groupId,
        p_first_start_at: startAt,
        p_duration_minutes: durationMinutes,
        p_occurrences_total: occurrences,
      })
      .single();

    setSubmitting(false);
    const row = data as { series_id: string; booked_count: number; failed_count: number } | null;
    if (createError || !row) {
      setError("Couldn't set up the recurring booking.");
      return;
    }
    setResult({ booked: row.booked_count, failed: row.failed_count });
    router.refresh();
  }

  if (result) {
    return (
      <p className="font-body text-[11px] text-steel">
        Booked {result.booked} of {occurrences} weekly sessions
        {result.failed > 0 ? ` (${result.failed} couldn't be booked — check your credits)` : ""}.
      </p>
    );
  }

  if (!open) {
    return (
      <button type="button" onClick={() => setOpen(true)} className="font-body text-[11px] text-rust">
        Book weekly →
      </button>
    );
  }

  return (
    <div className="flex flex-col items-end gap-1.5 border border-steel/20 bg-surface/40 p-2">
      <label className="font-body text-[11px] text-steel flex items-center gap-1.5">
        Repeat for
        <input
          type="number"
          min={1}
          max={12}
          value={occurrences}
          onChange={(e) => setOccurrences(Math.min(12, Math.max(1, Number(e.target.value) || 1)))}
          className="w-12 h-6 bg-graphite border border-steel/30 text-chalk px-1 font-body text-xs text-center"
        />
        weeks
      </label>
      <div className="flex items-center gap-2">
        <button
          type="button"
          onClick={() => setOpen(false)}
          className="font-body text-[11px] text-steel"
        >
          Cancel
        </button>
        <button
          type="button"
          onClick={handleCreate}
          disabled={submitting}
          className="h-7 px-2 bg-rust text-graphite font-body text-[11px] font-medium disabled:opacity-40"
        >
          {submitting ? "Booking…" : "Confirm"}
        </button>
      </div>
      {error && <span className="font-body text-[11px] text-rust">{error}</span>}
    </div>
  );
}
