"use client";

import { useState } from "react";
import { createBrowserClient } from "@/lib/supabase/client";
import { Trash2 } from "lucide-react";

const WEEKDAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

export interface AvailabilityWindowRow {
  id: string;
  weekday: number;
  startTime: string;
  endTime: string;
  slotDurationMinutes: number;
}

export function AvailabilityManager({
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
    <div>
      <div className="divide-y divide-steel/15">
        {windows.length === 0 && (
          <p className="font-body text-sm text-steel py-3">
            No recurring hours set yet — add one below.
          </p>
        )}
        {windows.map((w) => (
          <div key={w.id} className="flex items-center justify-between py-3">
            <div>
              <p className="font-body font-medium text-[15px]">{WEEKDAYS[w.weekday]}</p>
              <p className="font-body text-xs text-steel">
                {w.startTime.slice(0, 5)}–{w.endTime.slice(0, 5)} · {w.slotDurationMinutes}-min
                sessions
              </p>
            </div>
            <button
              type="button"
              onClick={() => handleDelete(w.id)}
              aria-label="Delete window"
              className="w-9 h-9 flex items-center justify-center text-steel active:text-rust transition-colors"
            >
              <Trash2 className="w-4 h-4" />
            </button>
          </div>
        ))}
      </div>

      <div className="border border-steel/20 p-4 mt-4 space-y-3">
        <p className="font-display uppercase text-xs tracking-wide text-steel">
          Add recurring window
        </p>
        <div className="flex flex-wrap items-end gap-3">
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
            <span className="font-body text-[11px] text-steel uppercase tracking-wide">
              Start
            </span>
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
              className="h-9 w-24 px-2 bg-surface border border-steel/30 text-chalk font-body text-xs"
            />
          </label>
          <button
            type="button"
            onClick={handleAdd}
            disabled={submitting}
            className="h-9 px-4 bg-rust text-graphite font-body text-xs font-medium disabled:opacity-40"
          >
            Add
          </button>
        </div>
        {error && <p className="font-body text-xs text-rust">{error}</p>}
      </div>
    </div>
  );
}
