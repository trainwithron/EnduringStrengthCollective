"use client";

import { useState } from "react";
import { formatInTimezone } from "@/lib/format-in-timezone";
import { dateKeyInZone } from "@/lib/timezone";
import { weekKeysMondayFirst } from "@/lib/booking-move";

const DAY_LETTERS = ["M", "T", "W", "T", "F", "S", "S"];

// Change the day of ONE booking, right where it is listed (Ron: "I should just be able to click into the date and change the number. Or click the day and it changes it to the correct day on that week."). A date box you can
// edit, and the seven days of that session's week (M T W T F S S): one tap moves it to that day, keeping its time of day. Saved the moment a day is picked; it stays the same booking, so its credit state does not change and a
// session moved into the past is still waiting to be marked.
export function BookingDateControl({ bookingId, startIso, timezone, onMoved }: { bookingId: string; startIso: string; timezone: string; onMoved: (newStartIso: string) => void }) {
  const [currentIso, setCurrentIso] = useState(startIso);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);
  const currentKey = dateKeyInZone(timezone, new Date(currentIso));
  const week = weekKeysMondayFirst(currentKey);

  async function move(newDateKey: string) {
    if (busy || !/^\d{4}-\d{2}-\d{2}$/.test(newDateKey) || newDateKey === currentKey) return;
    setBusy(true);
    setError(null);
    setDone(null);
    try {
      const res = await fetch("/api/bookings/move", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ bookingId, newDateKey }) });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data.startIso) {
        setError(data.error || "That didn't move. Nothing was changed.");
        return;
      }
      setCurrentIso(data.startIso);
      setDone(`Moved to ${formatInTimezone(new Date(data.startIso), timezone, "dateTime")}.`);
      onMoved(data.startIso);
    } catch {
      setError("That didn't move. Check your connection and try again.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="mt-1 border border-steel/25 bg-graphite p-2" role="group" aria-label="Change the day">
      <div className="flex flex-wrap items-center gap-2">
        <label className="flex items-center gap-1.5 font-body text-xs text-steel">
          Day
          <input
            type="date"
            value={currentKey}
            disabled={busy}
            onChange={(e) => void move(e.target.value)}
            className="h-9 bg-surface border border-steel/30 text-chalk px-2 font-body text-sm"
            aria-label="Date of this session"
          />
        </label>
      </div>
      <div className="mt-2 grid grid-cols-7 gap-1" role="group" aria-label="This week">
        {week.map((key, i) => {
          const on = key === currentKey;
          return (
            <button
              key={key}
              type="button"
              disabled={busy}
              aria-pressed={on}
              aria-label={new Date(`${key}T12:00:00Z`).toLocaleDateString("en-US", { weekday: "long", month: "short", day: "numeric", timeZone: "UTC" })}
              onClick={() => void move(key)}
              className={`min-h-11 flex flex-col items-center justify-center border font-body text-xs disabled:opacity-50 ${on ? "border-rust bg-rust/15 text-chalk" : "border-steel/30 text-steel"}`}
            >
              <span>{DAY_LETTERS[i]}</span>
              <span className="tabular-nums text-[11px]">{Number(key.slice(8))}</span>
            </button>
          );
        })}
      </div>
      {done && (
        <p className="font-body text-xs text-positive mt-2" role="status">
          {done}
        </p>
      )}
      {error && (
        <p className="font-body text-xs text-rust mt-2" role="alert">
          {error}
        </p>
      )}
    </div>
  );
}
