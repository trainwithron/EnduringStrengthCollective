"use client";

import { useState } from "react";
import { formatInTimezone } from "@/lib/format-in-timezone";
import { dateKeyInZone } from "@/lib/timezone";
import { clockTimeInZone, hhmmLabel, quarterHourTimes, weekKeysMondayFirst } from "@/lib/booking-move";

const DAY_LETTERS = ["M", "T", "W", "T", "F", "S", "S"];

// Change the day (and time) of ONE booking, right where it is listed (Ron: "I should just be able to click into the date and change the number. Or click the day and it changes it to the correct day on that week.").
// A date box you can edit, and the seven days of that session's week (M T W T F S S). Picking a day opens a time dropdown, set to the session's own time (Ron, Nov 3: "Whenever you select the day, it should have
// a time drop down"); Move saves both. It stays the same booking, so its credit state does not change and a session moved into the past is still waiting to be marked.
export function BookingDateControl({ bookingId, startIso, timezone, onMoved }: { bookingId: string; startIso: string; timezone: string; onMoved: (newStartIso: string) => void }) {
  const [currentIso, setCurrentIso] = useState(startIso);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);
  const currentKey = dateKeyInZone(timezone, new Date(currentIso));
  const currentTime = clockTimeInZone(currentIso, timezone);
  // The day picked and its time, before Move.
  const [pickedKey, setPickedKey] = useState<string | null>(null);
  const [time, setTime] = useState(currentTime);
  const shownKey = pickedKey ?? currentKey;
  const week = weekKeysMondayFirst(shownKey);

  function pick(key: string) {
    if (busy || !/^\d{4}-\d{2}-\d{2}$/.test(key)) return;
    setError(null);
    setDone(null);
    setPickedKey(key);
  }

  async function move() {
    if (busy || !pickedKey) return;
    if (pickedKey === currentKey && time === currentTime) {
      setPickedKey(null);
      return;
    }
    setBusy(true);
    setError(null);
    setDone(null);
    try {
      const res = await fetch("/api/bookings/move", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ bookingId, newDateKey: pickedKey, newTime: time }) });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data.startIso) {
        setError(data.error || "That didn't move. Nothing was changed.");
        return;
      }
      setCurrentIso(data.startIso);
      setPickedKey(null);
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
            value={shownKey}
            disabled={busy}
            onChange={(e) => pick(e.target.value)}
            className="h-9 bg-surface border border-steel/30 text-chalk px-2 font-body text-sm"
            aria-label="Date of this session"
          />
        </label>
      </div>
      <div className="mt-2 grid grid-cols-7 gap-1" role="group" aria-label="This week">
        {week.map((key, i) => {
          const on = key === shownKey;
          return (
            <button
              key={key}
              type="button"
              disabled={busy}
              aria-pressed={on}
              aria-label={new Date(`${key}T12:00:00Z`).toLocaleDateString("en-US", { weekday: "long", month: "short", day: "numeric", timeZone: "UTC" })}
              onClick={() => pick(key)}
              className={`min-h-11 flex flex-col items-center justify-center border font-body text-xs disabled:opacity-50 ${on ? "border-rust bg-rust/15 text-chalk" : "border-steel/30 text-steel"}`}
            >
              <span>{DAY_LETTERS[i]}</span>
              <span className="tabular-nums text-[11px]">{Number(key.slice(8))}</span>
            </button>
          );
        })}
      </div>
      {pickedKey && (
        <div className="mt-2 flex flex-wrap items-center gap-2" data-move-time>
          <label className="flex items-center gap-1.5 font-body text-xs text-steel">
            Time
            <select value={time} disabled={busy} onChange={(e) => setTime(e.target.value)} className="h-11 bg-surface border border-steel/30 text-chalk px-2 font-body text-sm" aria-label="Time of this session">
              {quarterHourTimes(currentTime).map((t) => (
                <option key={t} value={t}>
                  {hhmmLabel(t)}
                </option>
              ))}
            </select>
          </label>
          <button type="button" onClick={() => void move()} disabled={busy} className="min-h-11 px-4 bg-rust text-graphite font-body text-sm font-medium disabled:opacity-40">
            {busy ? "Moving…" : "Move"}
          </button>
          <button
            type="button"
            onClick={() => {
              setPickedKey(null);
              setTime(currentTime);
            }}
            disabled={busy}
            className="min-h-11 px-3 font-body text-sm text-steel"
          >
            Cancel
          </button>
        </div>
      )}
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
