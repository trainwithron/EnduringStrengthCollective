"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { createBrowserClient } from "@/lib/supabase/client";

export function CancelBookingButton({ bookingId }: { bookingId: string }) {
  const [submitting, setSubmitting] = useState(false);
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
