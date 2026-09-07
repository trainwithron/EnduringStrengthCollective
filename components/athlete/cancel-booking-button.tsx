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
      const { data: creditsRow } = await supabase
        .from("session_credits")
        .select("balance")
        .eq("athlete_id", booking.athlete_id)
        .eq("group_id", groupId)
        .maybeSingle();

      // Plain update — same reasoning as the booking flow: the row always
      // exists by now (it was decremented when this booking was made), and
      // an athlete cancelling their own booking has no INSERT policy.
      await supabase
        .from("session_credits")
        .update({ balance: (creditsRow?.balance ?? 0) + 1 })
        .eq("athlete_id", booking.athlete_id)
        .eq("group_id", groupId);
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
