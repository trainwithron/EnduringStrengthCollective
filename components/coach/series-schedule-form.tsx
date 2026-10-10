"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { addDaysToDateKey, wallClockOf, weekdayOfDateKey } from "@/lib/series-schedule";
import { dateKeyInZone, zonedTimeToUtc } from "@/lib/timezone";
import { formatInTimezone } from "@/lib/format-in-timezone";

interface PreviewRow {
  startIso: string;
  endIso: string;
  conflict: string | null;
  conflictLabel: string | null;
  blocking: boolean;
}

interface Preview {
  rows: PreviewRow[];
  error?: string;
}

const WEEKDAYS = ["Sundays", "Mondays", "Tuesdays", "Wednesdays", "Thursdays", "Fridays", "Saturdays"];

// Set up a weekly schedule for a client: pick the first day and time, how long, and how many weeks (or no end). A preview lists
// every date and flags the ones that clash, and each can be unticked before anything is booked. Times are the coach's own
// clock (the zone their account is set to), so 6:00 stays 6:00 when the clocks change.
export function SeriesScheduleForm({
  groupId,
  athleteId,
  athleteName,
  timezone,
  initialStartIso,
  defaultDurationMinutes = 60,
  onDone,
  onCancel,
}: {
  groupId: string;
  athleteId: string;
  athleteName: string;
  timezone: string;
  initialStartIso?: string;
  defaultDurationMinutes?: number;
  onDone?: () => void;
  onCancel?: () => void;
}) {
  const router = useRouter();
  const initial = useMemo(() => {
    if (initialStartIso) return wallClockOf(new Date(initialStartIso), timezone);
    return { dateKey: addDaysToDateKey(dateKeyInZone(timezone), 1), time: "06:00" };
  }, [initialStartIso, timezone]);

  const [dateKey, setDateKey] = useState(initial.dateKey);
  const [time, setTime] = useState(initial.time);
  const [duration, setDuration] = useState(defaultDurationMinutes);
  const [mode, setMode] = useState<"fixed" | "ongoing">("fixed");
  const [count, setCount] = useState(12);
  const [unticked, setUnticked] = useState<Set<string>>(new Set());
  const [preview, setPreview] = useState<Preview | null>(null);
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);
  const requestId = useRef(0);

  const firstStartIso = useMemo(() => {
    if (!dateKey || !/^\d{2}:\d{2}$/.test(time)) return null;
    return zonedTimeToUtc(dateKey, time, timezone).toISOString();
  }, [dateKey, time, timezone]);

  const payload = useMemo(
    () =>
      firstStartIso
        ? { groupId, athleteId, firstStartIso, durationMinutes: duration, mode, count: mode === "fixed" ? count : undefined }
        : null,
    [firstStartIso, groupId, athleteId, duration, mode, count]
  );

  // Refresh the preview a moment after the inputs settle.
  useEffect(() => {
    if (!payload) return;
    const id = ++requestId.current;
    setLoading(true);
    const t = setTimeout(async () => {
      try {
        const res = await fetch("/api/series/preview", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(payload) });
        const data = await res.json().catch(() => ({}));
        if (id !== requestId.current) return;
        if (!res.ok) setPreview({ rows: [], error: data.error ?? "Could not check those dates." });
        else setPreview(data as Preview);
      } catch {
        if (id === requestId.current) setPreview({ rows: [], error: "Could not check those dates." });
      } finally {
        if (id === requestId.current) setLoading(false);
      }
    }, 350);
    return () => clearTimeout(t);
  }, [payload]);

  // New inputs mean a new list of dates, so earlier unticks no longer apply.
  useEffect(() => {
    setUnticked(new Set());
  }, [firstStartIso, duration, mode, count]);

  const rows = preview?.rows ?? [];
  const bookable = rows.filter((r) => !r.blocking && !unticked.has(r.startIso));

  async function submit() {
    if (!payload) return;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/series", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ ...payload, skipStartsIso: [...unticked] }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error ?? "Could not create the schedule.");
      const skipped = (data.notBooked ?? []).length;
      setDone(`Booked ${data.booked} ${data.booked === 1 ? "session" : "sessions"} for ${athleteName}.${skipped > 0 ? ` ${skipped} could not be booked.` : ""}`);
      router.refresh();
      onDone?.();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not create the schedule.");
    } finally {
      setBusy(false);
    }
  }

  if (done) {
    return (
      <div className="font-body text-sm text-chalk" role="status">
        <p>{done}</p>
        {onCancel && (
          <button type="button" onClick={onCancel} className="mt-3 font-body text-xs text-steel underline">
            Close
          </button>
        )}
      </div>
    );
  }

  const weekdayName = dateKey ? WEEKDAYS[weekdayOfDateKey(dateKey)] : "";

  return (
    <div className="space-y-4">
      <p className="font-body text-xs text-steel">
        A weekly time for {athleteName}. Times are in your time zone ({timezone.replace("_", " ")}).
      </p>

      <div className="flex flex-wrap items-end gap-3">
        <label className="block">
          <span className="font-body text-xs text-steel block mb-1">First session</span>
          <input
            type="date"
            value={dateKey}
            onChange={(e) => setDateKey(e.target.value)}
            className="bg-transparent border border-steel/30 px-3 py-2 font-body text-base text-chalk"
          />
        </label>
        <label className="block">
          <span className="font-body text-xs text-steel block mb-1">Time</span>
          <input
            type="time"
            value={time}
            onChange={(e) => setTime(e.target.value)}
            className="bg-transparent border border-steel/30 px-3 py-2 font-body text-base text-chalk"
          />
        </label>
        <label className="block">
          <span className="font-body text-xs text-steel block mb-1">Length (minutes)</span>
          <input
            type="number"
            min={5}
            max={480}
            step={5}
            value={duration}
            onChange={(e) => setDuration(Number(e.target.value) || 0)}
            className="w-24 bg-transparent border border-steel/30 px-3 py-2 font-body text-base text-chalk"
          />
        </label>
      </div>

      <fieldset className="space-y-2">
        <legend className="font-body text-xs text-steel mb-1">Repeats {weekdayName && <span className="text-chalk">{weekdayName}</span>}</legend>
        <label className="flex items-center gap-2 font-body text-sm text-chalk">
          <input type="radio" name="series-mode" checked={mode === "fixed"} onChange={() => setMode("fixed")} />
          For
          <input
            type="number"
            min={1}
            max={52}
            value={count}
            onChange={(e) => setCount(Math.min(52, Math.max(1, Number(e.target.value) || 1)))}
            disabled={mode !== "fixed"}
            aria-label="Number of weeks"
            className="w-16 bg-transparent border border-steel/30 px-2 py-1 font-body text-base text-chalk disabled:opacity-40"
          />
          weeks
        </label>
        <label className="flex items-start gap-2 font-body text-sm text-chalk">
          <input type="radio" name="series-mode" className="mt-1" checked={mode === "ongoing"} onChange={() => setMode("ongoing")} />
          <span>
            No end date
            <span className="block text-xs text-steel">Always kept booked 12 weeks ahead. Pause or end it any time.</span>
          </span>
        </label>
      </fieldset>

      <div>
        <p className="font-body text-xs text-steel mb-2">
          {loading ? "Checking your calendar…" : rows.length > 0 ? `${bookable.length} of ${rows.length} dates will be booked` : "Dates"}
        </p>
        {preview?.error && (
          <p className="font-body text-sm text-rust" role="alert">
            {preview.error}
          </p>
        )}
        {rows.length > 0 && (
          <ul className="max-h-64 overflow-y-auto divide-y divide-steel/15 border border-steel/20">
            {rows.map((r) => {
              const ticked = !r.blocking && !unticked.has(r.startIso);
              return (
                <li key={r.startIso} className="flex items-center gap-3 px-3 py-2">
                  <input
                    type="checkbox"
                    checked={ticked}
                    disabled={r.blocking}
                    aria-label={`Book ${formatInTimezone(new Date(r.startIso), timezone, "dateTime")}`}
                    onChange={() => {
                      setUnticked((prev) => {
                        const next = new Set(prev);
                        if (next.has(r.startIso)) next.delete(r.startIso);
                        else next.add(r.startIso);
                        return next;
                      });
                    }}
                  />
                  <span className={`font-body text-sm flex-1 ${r.blocking ? "text-steel line-through" : "text-chalk"}`}>
                    {formatInTimezone(new Date(r.startIso), timezone, "dateTime")}
                  </span>
                  {r.conflictLabel && (
                    <span className={`font-body text-xs ${r.blocking ? "text-rust" : "text-steel"}`}>{r.conflictLabel}</span>
                  )}
                </li>
              );
            })}
          </ul>
        )}
        {mode === "ongoing" && rows.length > 0 && (
          <p className="font-body text-xs text-steel mt-2">The next 12 weeks are shown. Later weeks are booked automatically each day.</p>
        )}
      </div>

      {error && (
        <p className="font-body text-sm text-rust" role="alert">
          {error}
        </p>
      )}

      <div className="flex items-center gap-3">
        <button
          type="button"
          onClick={submit}
          disabled={busy || loading || bookable.length === 0 || !!preview?.error}
          className="bg-rust text-graphite font-display font-bold uppercase tracking-wide px-4 py-2 disabled:opacity-40"
        >
          {busy ? "Booking…" : `Book ${bookable.length} ${bookable.length === 1 ? "session" : "sessions"}`}
        </button>
        {onCancel && (
          <button type="button" onClick={onCancel} className="font-body text-sm text-steel">
            Cancel
          </button>
        )}
      </div>
    </div>
  );
}
