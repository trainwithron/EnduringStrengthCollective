"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { DEFAULT_FIX_MINUTES, saveFixedTime, validFixMinutes } from "@/lib/workout-time-fix";

// On a logged workout that ran over 90 minutes: type the real length. Most of these are a timer left running.
export function FixWorkoutTime({ sessionId }: { sessionId: string }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [minutes, setMinutes] = useState(String(DEFAULT_FIX_MINUTES));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function save() {
    const value = validFixMinutes(minutes);
    if (value == null) return setError("Enter the minutes, from 1 to 600.");
    setBusy(true);
    setError(null);
    const ok = await saveFixedTime(sessionId, value);
    setBusy(false);
    if (!ok) return setError("Couldn't save that. Try again.");
    setOpen(false);
    router.refresh();
  }

  if (!open) {
    return (
      <button type="button" onClick={() => setOpen(true)} className="font-body text-xs text-rust px-4 min-h-11 inline-flex items-center">
        Fix time
      </button>
    );
  }
  return (
    <div className="px-4 pb-3 flex flex-wrap items-center gap-2">
      <label className="font-body text-xs text-steel flex items-center gap-2">
        Minutes
        <input
          type="number"
          inputMode="numeric"
          min={1}
          max={600}
          value={minutes}
          onChange={(e) => setMinutes(e.target.value)}
          aria-label="Minutes the workout took" className="w-20 h-11 bg-surface border border-steel/30 text-chalk px-2 font-body text-sm focus:outline-none focus:border-rust"
        />
      </label>
      <button type="button" onClick={() => void save()} disabled={busy} className="h-11 px-4 bg-rust text-graphite font-body text-sm font-medium disabled:opacity-40">
        {busy ? "Saving…" : "Save"}
      </button>
      <button type="button" onClick={() => setOpen(false)} disabled={busy} className="h-11 px-3 border border-steel/30 text-steel font-body text-sm">
        Cancel
      </button>
      {error && (
        <p className="w-full font-body text-xs text-rust" role="alert">
          {error}
        </p>
      )}
    </div>
  );
}
