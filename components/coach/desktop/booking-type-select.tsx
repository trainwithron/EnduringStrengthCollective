"use client";

import { useState } from "react";
import { createBrowserClient } from "@/lib/supabase/client";

// The session type of one booked session (Online, In person, Practice...). A session booked inside tagged hours already carries that type; the coach can set or
// change it here. It never changes what the session costs.
export function BookingTypeSelect({ bookingId, types, current }: { bookingId: string; types: { id: string; name: string }[]; current: string | null }) {
  const [value, setValue] = useState(current ?? "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function change(next: string) {
    const previous = value;
    setValue(next);
    setBusy(true);
    setError(null);
    const { error: updateError } = await createBrowserClient().from("bookings").update({ session_type_id: next || null }).eq("id", bookingId);
    setBusy(false);
    if (updateError) {
      setValue(previous);
      setError("That didn't save.");
    }
  }

  return (
    <span className="inline-flex items-center gap-1.5">
      <select
        value={value}
        disabled={busy}
        onChange={(e) => change(e.target.value)}
        aria-label="Session type"
        className="h-8 bg-surface border border-steel/30 text-chalk px-1.5 font-body text-xs disabled:opacity-60"
      >
        <option value="">No type</option>
        {types.map((t) => (
          <option key={t.id} value={t.id}>
            {t.name}
          </option>
        ))}
      </select>
      {error && <span className="font-body text-xs text-rust">{error}</span>}
    </span>
  );
}
