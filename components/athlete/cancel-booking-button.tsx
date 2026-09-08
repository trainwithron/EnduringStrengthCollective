"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { createBrowserClient } from "@/lib/supabase/client";

export function CancelBookingButton({
  bookingId,
  groupId,
}: {
  bookingId: string;
  groupId: string;
}) {
  const [submitting, setSubmitting] = useState(false);
  const router = useRouter();

  async function handleCancel() {
    setSubmitting(true);
    const supabase = createBrowserClient();

    const { data: booking } = await supabase
      .from("bookings")
      .select("athlete_id")
      .eq("id", bookingId)
      .single();

    await supabase.from("bookings").update({ status: "cancelled" }).eq("id", bookingId);

    if (booking) {
      // Atomic DB-side increment — see book-slot-button.tsx for why this
      // isn't a read-then-write anymore.
      await supabase.rpc("adjust_session_credits", {
        p_athlete_id: booking.athlete_id,
        p_group_id: groupId,
        p_delta: 1,
      });
    }

    router.refresh();
  }

  return (
    <button
      type="button"
      onClick={handleCancel}
      disabled={submitting}
      className="h-8 px-3 border border-steel/30 text-steel font-body text-xs active:border-rust active:text-rust transition-colors disabled:opacity-40"
    >
      {submitting ? "Cancelling…" : "Booked ✓ Cancel"}
    </button>
  );
}
