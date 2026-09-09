"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { createBrowserClient } from "@/lib/supabase/client";

export function BookSlotButton({
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

  async function handleBook() {
    setSubmitting(true);
    setError(null);
    const supabase = createBrowserClient();

    // One atomic, security-definer RPC: checks a credit actually exists,
    // checks for any overlapping confirmed booking (not just an exact
    // start_at collision), inserts, then spends the credit — all in one
    // transaction, so nothing between the check and the write can race.
    const { error: bookError } = await supabase.rpc("book_session", {
      p_coach_id: coachId,
      p_athlete_id: athleteId,
      p_group_id: groupId,
      p_start_at: startAt,
      p_end_at: endAt,
    });

    if (bookError) {
      setError(
        bookError.message.includes("no session credits")
          ? "No sessions remaining — contact your coach."
          : bookError.message.includes("just taken")
            ? "That slot was just taken. Try another."
            : "Couldn't book that slot."
      );
      setSubmitting(false);
      router.refresh();
      return;
    }

    router.refresh();
  }

  return (
    <div className="flex flex-col items-end gap-1">
      <button
        type="button"
        onClick={handleBook}
        disabled={submitting}
        className="h-8 px-3 bg-rust text-graphite font-body text-xs font-medium disabled:opacity-40"
      >
        {submitting ? "Booking…" : "Book"}
      </button>
      {error && <span className="font-body text-[11px] text-rust">{error}</span>}
    </div>
  );
}
