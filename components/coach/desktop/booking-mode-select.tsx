"use client";

import { useState } from "react";
import { createBrowserClient } from "@/lib/supabase/client";

export type BookingMode = "free" | "request" | "coach_schedules";

const OPTIONS: { value: BookingMode; label: string; hint: string }[] = [
  { value: "free", label: "Clients book on their own", hint: "A client picks any open time and it is booked at once." },
  { value: "request", label: "Clients request, I confirm", hint: "A client asks for a time or a move. Nothing is booked or held until you confirm it." },
  { value: "coach_schedules", label: "I schedule everyone", hint: "Clients cannot book or move sessions. They message you and you schedule them." },
];

// How clients book with this coach. Saved on its own; the database enforces it, so an old screen cannot get around it. A coach can always schedule.
export function BookingModeSelect({ coachId, initialMode }: { coachId: string; initialMode: BookingMode }) {
  const [mode, setMode] = useState<BookingMode>(initialMode);
  const [error, setError] = useState<string | null>(null);

  async function choose(next: BookingMode) {
    const previous = mode;
    setMode(next);
    setError(null);
    const supabase = createBrowserClient();
    const { error: saveError } = await supabase
      .from("coach_booking_policies")
      .upsert({ coach_id: coachId, booking_mode: next }, { onConflict: "coach_id" });
    if (saveError) {
      setMode(previous);
      setError("That didn't save. It is back to what it was.");
    }
  }

  return (
    <fieldset className="border border-steel/20 bg-surface/40 rounded-token-lg p-4 mb-6 max-w-md">
      <legend className="font-body text-sm text-chalk px-1">How clients book</legend>
      <div className="space-y-3 mt-1">
        {OPTIONS.map((o) => (
          <label key={o.value} className="flex items-start gap-3 cursor-pointer">
            <input
              type="radio"
              name="booking-mode"
              checked={mode === o.value}
              onChange={() => choose(o.value)}
              className="mt-1 w-5 h-5 accent-rust shrink-0"
            />
            <span>
              <span className="font-body text-sm text-chalk block">{o.label}</span>
              <span className="font-body text-xs text-steel block mt-0.5">{o.hint}</span>
            </span>
          </label>
        ))}
      </div>
      {error && (
        <p className="font-body text-xs text-rust mt-2" role="alert">
          {error}
        </p>
      )}
    </fieldset>
  );
}
