"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { createBrowserClient } from "@/lib/supabase/client";
import { AlertTriangle } from "lucide-react";

// acuity_replacement_gap_audit_sept16.md — recurring bookings, Q4's
// confirmed answer: a future occurrence that no longer fits the
// coach's current real availability is flagged for the coach to
// resolve, never silently auto-cancelled or silently left to
// double-book. This is that resolution UI, shown only on the coach's
// own view of a flagged booking.
export function RecurringConflictBadge({ bookingId }: { bookingId: string }) {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const router = useRouter();

  async function resolve(cancel: boolean) {
    setBusy(true);
    const supabase = createBrowserClient();
    await supabase.rpc("resolve_recurring_booking_conflict", { p_booking_id: bookingId, p_cancel: cancel });
    setBusy(false);
    router.refresh();
  }

  return (
    <div className="relative inline-block">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        title="No longer fits your availability — resolve"
        className="text-rust"
      >
        <AlertTriangle className="w-3.5 h-3.5" />
      </button>
      {open && (
        <div className="absolute right-0 top-5 z-20 w-56 bg-surface border border-rust/40 shadow-lg p-2 space-y-1.5">
          <p className="font-body text-[11px] text-rust">This no longer fits your available hours.</p>
          <button
            type="button"
            disabled={busy}
            onClick={() => resolve(false)}
            className="w-full text-left font-body text-xs text-chalk hover:bg-graphite/50 px-1.5 py-1 disabled:opacity-40"
          >
            Keep it anyway
          </button>
          <button
            type="button"
            disabled={busy}
            onClick={() => resolve(true)}
            className="w-full text-left font-body text-xs text-rust hover:bg-graphite/50 px-1.5 py-1 disabled:opacity-40"
          >
            {busy ? "Cancelling…" : "Cancel this session"}
          </button>
        </div>
      )}
    </div>
  );
}
