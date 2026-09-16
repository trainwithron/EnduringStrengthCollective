"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { createBrowserClient } from "@/lib/supabase/client";

// scheduling_calendar_spotter_idea.md — a past confirmed booking is
// presumed attended unless the coach flags it, so this is the ONLY
// attendance control that needs to exist: one button for the exceptional
// case (a client didn't show), not a "mark attended" click required for
// every normal session (coach_ease_of_use_design_principle.md's "Excel
// shortcuts" test). Only ever shown for a booking whose start time has
// already passed — set_booking_no_show itself also rejects a future one.
export function MarkNoShowToggle({
  bookingId,
  initialNoShow,
}: {
  bookingId: string;
  initialNoShow: boolean;
}) {
  const [noShow, setNoShow] = useState(initialNoShow);
  const [busy, setBusy] = useState(false);
  const router = useRouter();

  async function toggle() {
    setBusy(true);
    const supabase = createBrowserClient();
    const next = !noShow;
    const { error } = await supabase.rpc("set_booking_no_show", {
      p_booking_id: bookingId,
      p_no_show: next,
    });
    if (!error) {
      setNoShow(next);
      router.refresh();
    }
    setBusy(false);
  }

  if (noShow) {
    return (
      <button
        type="button"
        onClick={toggle}
        disabled={busy}
        className="h-8 px-3 border border-rust/40 text-rust font-body text-xs disabled:opacity-40"
      >
        {busy ? "Undoing…" : "No-show ✓ Undo"}
      </button>
    );
  }

  return (
    <button
      type="button"
      onClick={toggle}
      disabled={busy}
      className="h-8 px-3 border border-steel/30 text-steel font-body text-xs active:border-rust active:text-rust transition-colors disabled:opacity-40"
    >
      {busy ? "Marking…" : "Mark no-show"}
    </button>
  );
}
