"use client";

import { useState } from "react";
import { createBrowserClient } from "@/lib/supabase/client";

// Coach-only opt-in: a booking is in-person by default (session_type
// unchanged for every existing/new booking), so this is a deliberate
// per-session choice, not a new booking-creation step. Uses the same
// bookings_update_own_or_coach RLS policy every other booking mutation
// already relies on.
export function BookingVideoToggle({
  bookingId,
  initialSessionType,
  onChanged,
}: {
  bookingId: string;
  initialSessionType: "in_person" | "video";
  onChanged: (sessionType: "in_person" | "video") => void;
}) {
  const [sessionType, setSessionType] = useState(initialSessionType);
  const [busy, setBusy] = useState(false);

  async function toggle() {
    setBusy(true);
    const next = sessionType === "video" ? "in_person" : "video";
    const supabase = createBrowserClient();
    const { error } = await supabase.from("bookings").update({ session_type: next }).eq("id", bookingId);
    setBusy(false);
    if (!error) {
      setSessionType(next);
      onChanged(next);
    }
  }

  return (
    <button
      type="button"
      onClick={toggle}
      disabled={busy}
      className="font-body text-[11px] text-steel underline disabled:opacity-40"
    >
      {sessionType === "video" ? "Make in-person" : "Make video call"}
    </button>
  );
}
