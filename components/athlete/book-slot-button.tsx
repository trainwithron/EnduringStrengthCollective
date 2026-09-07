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

    // The partial unique index on (coach_id, start_at) is the real guard
    // against double-booking a slot two clients raced for — this insert
    // simply fails if someone else just took it.
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

    const { data: creditsRow } = await supabase
      .from("session_credits")
      .select("balance")
      .eq("athlete_id", athleteId)
      .eq("group_id", groupId)
      .maybeSingle();

    // A plain update, not upsert — the row always exists by the time a
    // booking happens (the "Book" button only shows once a balance row
    // with credits > 0 was already fetched), and upsert would need an
    // INSERT policy the athlete doesn't have, even on the conflict path.
    await supabase
      .from("session_credits")
      .update({ balance: Math.max(0, (creditsRow?.balance ?? 0) - 1) })
      .eq("athlete_id", athleteId)
      .eq("group_id", groupId);

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
