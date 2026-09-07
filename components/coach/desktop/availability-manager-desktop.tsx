"use client";

import { useState } from "react";
import { createBrowserClient } from "@/lib/supabase/client";
import { Trash2 } from "lucide-react";
import type { AvailabilityWindowRow } from "../availability-manager";

const WEEKDAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

export function AvailabilityManagerDesktop({
  coachId,
  initialWindows,
}: {
  coachId: string;
  initialWindows: AvailabilityWindowRow[];
}) {
  const [windows, setWindows] = useState(initialWindows);
  const [weekday, setWeekday] = useState("1");
  const [startTime, setStartTime] = useState("17:00");
  const [endTime, setEndTime] = useState("20:00");
  const [slotDuration, setSlotDuration] = useState("60");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleAdd() {
    setError(null);
    if (startTime >= endTime) {
      setError("End time must be after start time.");
      return;
    }
    setSubmitting(true);
    const supabase = createBrowserClient();
    const { data, error: insertError } = await supabase
      .from("coach_availability_windows")
      .insert({
        coach_id: coachId,
        weekday: Number(weekday),
        start_time: startTime,
        end_time: endTime,
        slot_duration_minutes: Number(slotDuration),
      })
      .select("id, weekday, start_time, end_time, slot_duration_minutes")
      .single();

    if (data) {
      setWindows((prev) =>
        [
          ...prev,
          {
            id: data.id,
            weekday: data.weekday,
            startTime: data.start_time,
            endTime: data.end_time,
            slotDurationMinutes: data.slot_duration_minutes,
          },
        ].sort((a, b) => a.weekday - b.weekday || a.startTime.localeCompare(b.startTime))
      );
    } else if (insertError) {
      setError("Couldn't save that window.");
    }
    setSubmitting(false);
  }

  async function handleDelete(id: string) {
    setWindows((prev) => prev.filter((w) => w.id !== id));
    const supabase = createBrowserClient();
    await supabase.from("coach_availability_windows").delete().eq("id", id);
  }

  return (
    <div className="grid grid-cols-[1fr_320px] gap-10 items-start">
      <div>
        <h2 className="font-display uppercase text-sm tracking-wide text-steel mb-3">
          Recurring hours
        </h2>
        {windows.length === 0 ? (
          <p className="font-body text-sm text-steel py-3">
            No recurring hours set yet — add one on the right.
          </p>
        ) : (
          <table className="w-full border-collapse">
            <thead>
              <tr className="border-b border-steel/20">
                <th className="text-left font-body text-xs text-steel uppercase tracking-wide font-medium py-2">
                  Day
                </th>
                <th className="text-left font-body text-xs text-steel uppercase tracking-wide font-medium py-2">
                  Time
                </th>
                <th className="text-left font-body text-xs text-steel uppercase tracking-wide font-medium py-2">
                  Session length
                </th>
                <th className="py-2" />
              </tr>
            </thead>
            <tbody>
              {windows.map((w) => (
                <tr key={w.id} className="border-b border-steel/15">
                  <td className="py-3 font-body text-sm">{WEEKDAYS[w.weekday]}</td>
                  <td className="py-3 font-body text-sm text-steel">
                    {w.startTime.slice(0, 5)}–{w.endTime.slice(0, 5)}
                  </td>
                  <td className="py-3 font-body text-sm text-steel">
                    {w.slotDurationMinutes} min
                  </td>
                  <td className="py-3 text-right">
                    <button
                      type="button"
                      onClick={() => handleDelete(w.id)}
                      aria-label="Delete window"
                      className="w-8 h-8 inline-flex items-center justify-center text-steel active:text-rust transition-colors"
                    >
                      <Trash2 className="w-4 h-4" />
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      <div className="border border-steel/20 p-4 space-y-3">
        <p className="font-display uppercase text-xs tracking-wide text-steel">
          Add recurring window
        </p>
        <label className="flex flex-col gap-1">
          <span className="font-body text-[11px] text-steel uppercase tracking-wide">Day</span>
          <select
            value={weekday}
            onChange={(e) => setWeekday(e.target.value)}
            className="h-9 px-2 bg-surface border border-steel/30 text-chalk font-body text-xs"
          >
            {WEEKDAYS.map((label, i) => (
              <option key={i} value={i}>
                {label}
              </option>
            ))}
          </select>
        </label>
        <label className="flex flex-col gap-1">
          <span className="font-body text-[11px] text-steel uppercase tracking-wide">Start</span>
          <input
            type="time"
            value={startTime}
            onChange={(e) => setStartTime(e.target.value)}
            className="h-9 px-2 bg-surface border border-steel/30 text-chalk font-body text-xs"
          />
        </label>
        <label className="flex flex-col gap-1">
          <span className="font-body text-[11px] text-steel uppercase tracking-wide">End</span>
          <input
            type="time"
            value={endTime}
            onChange={(e) => setEndTime(e.target.value)}
            className="h-9 px-2 bg-surface border border-steel/30 text-chalk font-body text-xs"
          />
        </label>
        <label className="flex flex-col gap-1">
          <span className="font-body text-[11px] text-steel uppercase tracking-wide">
            Minutes/session
          </span>
          <input
            type="number"
            min={5}
            value={slotDuration}
            onChange={(e) => setSlotDuration(e.target.value)}
            className="h-9 px-2 bg-surface border border-steel/30 text-chalk font-body text-xs"
          />
        </label>
        <button
          type="button"
          onClick={handleAdd}
          disabled={submitting}
          className="w-full h-9 bg-rust text-graphite font-body text-xs font-medium disabled:opacity-40"
        >
          Add
        </button>
        {error && <p className="font-body text-xs text-rust">{error}</p>}
      </div>
    </div>
  );
}
