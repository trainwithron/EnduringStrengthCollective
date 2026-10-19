"use client";

import { useState } from "react";
import { createBrowserClient } from "@/lib/supabase/client";

export type BookingMode = "free" | "request" | "coach_schedules";

const OPTIONS: { value: BookingMode; label: string; hint: string }[] = [
  { value: "free", label: "Clients book on their own", hint: "A client picks any open time and it is booked at once." },
  { value: "request", label: "Clients request, I confirm", hint: "A client asks for a time or a move. Nothing is booked or held until you confirm it." },
  { value: "coach_schedules", label: "I schedule everyone", hint: "Clients cannot book or move sessions. They message you and you schedule them." },
];

// How clients book with this coach: three large choices, the current one clearly selected (a coach who never chose is shown the default, "I schedule everyone"), saved the moment one is tapped. The database enforces
// it, so an old screen cannot get around it. A coach can always schedule.
export function BookingModeSelect({ coachId, initialMode }: { coachId: string; initialMode: BookingMode }) {
  const [mode, setMode] = useState<BookingMode>(initialMode);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [busy, setBusy] = useState(false);

  async function choose(next: BookingMode) {
    if (busy || next === mode) return;
    const previous = mode;
    setMode(next);
    setError(null);
    setSaved(false);
    setBusy(true);
    const supabase = createBrowserClient();
    const { error: saveError } = await supabase
      .from("coach_booking_policies")
      .upsert({ coach_id: coachId, booking_mode: next }, { onConflict: "coach_id" });
    setBusy(false);
    if (saveError) {
      setMode(previous);
      setError("That didn't save. It is back to what it was.");
      return;
    }
    setSaved(true);
    setTimeout(() => setSaved(false), 2500);
  }

  return (
    <section className="mb-6 max-w-2xl" aria-labelledby="how-clients-book">
      <div className="flex items-baseline gap-3 mb-2">
        <h2 id="how-clients-book" className="font-display uppercase text-lg tracking-wide">
          How clients book
        </h2>
        {saved && (
          <span className="font-body text-xs text-positive" role="status">
            Saved
          </span>
        )}
      </div>
      <div role="radiogroup" aria-labelledby="how-clients-book" className="grid gap-2">
        {OPTIONS.map((o) => {
          const on = mode === o.value;
          return (
            <button
              key={o.value}
              type="button"
              role="radio"
              aria-checked={on}
              disabled={busy}
              onClick={() => choose(o.value)}
              className={`w-full text-left min-h-16 px-4 py-3 border-2 flex items-start gap-3 disabled:opacity-60 ${on ? "border-rust bg-rust/10" : "border-steel/25 hover:border-steel/50"}`}
            >
              <span aria-hidden="true" className={`mt-1 w-5 h-5 shrink-0 rounded-full border-2 flex items-center justify-center ${on ? "border-rust" : "border-steel/50"}`}>
                {on && <span className="w-2.5 h-2.5 rounded-full bg-rust" />}
              </span>
              <span>
                <span className="font-body text-base text-chalk block">{o.label}</span>
                <span className="font-body text-xs text-steel block mt-0.5">{o.hint}</span>
              </span>
            </button>
          );
        })}
      </div>
      {error && (
        <p className="font-body text-xs text-rust mt-2" role="alert">
          {error}
        </p>
      )}
    </section>
  );
}
