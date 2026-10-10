"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { addDaysToDateKey, wallClockOf } from "@/lib/series-schedule";
import { dateKeyInZone, zonedTimeToUtc } from "@/lib/timezone";
import { formatInTimezone } from "@/lib/format-in-timezone";
import { createBrowserClient } from "@/lib/supabase/client";
import { buildCreditPicture, fetchBookingCounts } from "@/lib/credit-picture";
import { planRunOut, rowFirstDateKey, rowWeekday, type DayRow } from "@/lib/series-multi";

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

type Mode = "fixed" | "runout" | "ongoing";

const WEEKDAYS = ["Sundays", "Mondays", "Tuesdays", "Wednesdays", "Thursdays", "Fridays", "Saturdays"];

// Set up weekly times for a client: pick the first day, add a row for each weekday and its own time (Mondays 6:00 AM, Thursdays 3:00 PM), how long, and how many weeks
// (or until their sessions run out, or no end). A preview lists every date and flags the ones that clash, and each can be unticked before anything is booked. Each
// day row becomes its own weekly series, so one can be paused or ended without the others. Times are the coach's own clock (the zone their account is set to), so
// 6:00 stays 6:00 when the clocks change.
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

  const [startDateKey, setStartDateKey] = useState(initial.dateKey);
  const [rows, setRows] = useState<DayRow[]>([{ id: 1, weekday: null, time: initial.time }]);
  const nextRowId = useRef(2);
  const [duration, setDuration] = useState(defaultDurationMinutes);
  const [mode, setMode] = useState<Mode>("fixed");
  const [count, setCount] = useState(12);
  const [unticked, setUnticked] = useState<Set<string>>(new Set());
  const [previews, setPreviews] = useState<(Preview | null)[]>([null]);
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);
  // Sessions the client still has to book (sessions left minus the ones already booked); null until read, or when it could not be read.
  const [sessionsToBook, setSessionsToBook] = useState<number | null>(null);
  const requestId = useRef(0);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const supabase = createBrowserClient();
      const [{ data: credit, error: creditError }, counts] = await Promise.all([
        supabase.from("session_credits").select("balance").eq("athlete_id", athleteId).eq("group_id", groupId).maybeSingle(),
        fetchBookingCounts(supabase, { athleteId, groupId }),
      ]);
      if (cancelled || creditError) return;
      const booked = counts.get(`${athleteId}:${groupId}`)?.booked ?? 0;
      setSessionsToBook(buildCreditPicture({ balance: (credit as { balance: number } | null)?.balance ?? 0, booked, toMark: 0 }).toBook);
    })().catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [athleteId, groupId]);

  // One request per day row: the row's own first date and time.
  const payloads = useMemo(
    () =>
      rows.map((r) => {
        const dateKey = rowFirstDateKey(startDateKey, r.weekday);
        if (!dateKey || !/^\d{2}:\d{2}$/.test(r.time)) return null;
        return {
          groupId,
          athleteId,
          firstStartIso: zonedTimeToUtc(dateKey, r.time, timezone).toISOString(),
          durationMinutes: duration,
          mode: mode === "ongoing" ? ("ongoing" as const) : ("fixed" as const),
          count: mode === "ongoing" ? undefined : mode === "runout" ? 52 : count,
        };
      }),
    [rows, startDateKey, groupId, athleteId, timezone, duration, mode, count]
  );
  const payloadKey = JSON.stringify(payloads);

  // Refresh the previews a moment after the inputs settle.
  useEffect(() => {
    if (payloads.some((p) => !p)) return;
    const id = ++requestId.current;
    setLoading(true);
    const t = setTimeout(async () => {
      const one = async (payload: NonNullable<(typeof payloads)[number]>): Promise<Preview> => {
        try {
          const res = await fetch("/api/series/preview", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(payload) });
          const data = await res.json().catch(() => ({}));
          return res.ok ? (data as Preview) : { rows: [], error: data.error ?? "Could not check those dates." };
        } catch {
          return { rows: [], error: "Could not check those dates." };
        }
      };
      const results = await Promise.all(payloads.map((p) => one(p!)));
      if (id !== requestId.current) return;
      setPreviews(results);
      setLoading(false);
    }, 350);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [payloadKey]);

  // New inputs mean a new list of dates, so earlier unticks no longer apply.
  useEffect(() => {
    setUnticked(new Set());
  }, [payloadKey]);

  const previewError = previews.find((p) => p?.error)?.error;
  const rowDates = rows.map((_, i) => (previews[i]?.rows ?? []).map((r) => ({ startIso: r.startIso, blocking: r.blocking })));
  const plan = mode === "runout" ? planRunOut(rowDates, unticked, sessionsToBook ?? 0) : null;

  // What the preview lists, in date order across every row, and which of those will be booked.
  const labelByIso = new Map<string, PreviewRow>();
  previews.forEach((p) => (p?.rows ?? []).forEach((r) => labelByIso.set(r.startIso, r)));
  const shown: { startIso: string; blocking: boolean }[] = plan
    ? plan.shown
    : previews
        .flatMap((p) => p?.rows ?? [])
        .map((r) => ({ startIso: r.startIso, blocking: r.blocking }))
        .sort((a, b) => a.startIso.localeCompare(b.startIso));
  const bookedSet = new Set(plan ? plan.booked : shown.filter((r) => !r.blocking && !unticked.has(r.startIso)).map((r) => r.startIso));
  const bookableCount = bookedSet.size;

  function updateRow(id: number, patch: Partial<DayRow>) {
    setRows((prev) => prev.map((r) => (r.id === id ? { ...r, ...patch } : r)));
  }
  function addRow() {
    setRows((prev) => {
      const taken = new Set(prev.map((r) => rowWeekday(startDateKey, r.weekday)));
      let weekday = (rowWeekday(startDateKey, prev[prev.length - 1].weekday) + 3) % 7;
      for (let i = 0; i < 7 && taken.has(weekday); i++) weekday = (weekday + 1) % 7;
      return [...prev, { id: nextRowId.current++, weekday, time: prev[prev.length - 1].time }];
    });
    setPreviews((prev) => [...prev, null]);
  }
  function removeRow(id: number) {
    setRows((prev) => {
      const index = prev.findIndex((r) => r.id === id);
      setPreviews((p) => p.filter((_, i) => i !== index));
      return prev.filter((r) => r.id !== id);
    });
  }

  async function submit() {
    if (payloads.some((p) => !p)) return;
    setBusy(true);
    setError(null);
    const made: string[] = [];
    let booked = 0;
    let notBooked = 0;
    try {
      for (let i = 0; i < rows.length; i++) {
        const payload = payloads[i]!;
        const dates = previews[i]?.rows ?? [];
        let rowCount = payload.count;
        let skip: string[];
        if (plan) {
          if (plan.rows[i].count === 0) continue;
          rowCount = plan.rows[i].count;
          skip = plan.rows[i].skipStartsIso;
        } else {
          if (!dates.some((d) => bookedSet.has(d.startIso))) continue;
          skip = dates.filter((d) => unticked.has(d.startIso)).map((d) => d.startIso);
        }
        const dayName = WEEKDAYS[rowWeekday(startDateKey, rows[i].weekday)];
        const res = await fetch("/api/series", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ ...payload, mode: payload.mode, count: payload.mode === "ongoing" ? undefined : rowCount, skipStartsIso: skip }),
        });
        const data = await res.json().catch(() => ({}));
        if (!res.ok) {
          const sofar = made.length > 0 ? ` ${made.join(" and ")} ${made.length === 1 ? "was" : "were"} already booked.` : "";
          throw new Error(`${dayName}: ${data.error ?? "Could not create the schedule."}${sofar}`);
        }
        made.push(dayName);
        booked += data.booked ?? 0;
        notBooked += (data.notBooked ?? []).length;
      }
      setDone(`Booked ${booked} ${booked === 1 ? "session" : "sessions"} for ${athleteName}.${notBooked > 0 ? ` ${notBooked} could not be booked.` : ""}`);
      router.refresh();
      onDone?.();
    } catch (e) {
      if (made.length > 0) router.refresh();
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

  const weekdayName = rows.map((r) => WEEKDAYS[rowWeekday(startDateKey, r.weekday)]).join(" and ");
  const inputClass = "bg-transparent border border-steel/30 px-3 py-2 font-body text-base text-chalk";

  return (
    <div className="space-y-4">
      <p className="font-body text-xs text-steel">
        A weekly time for {athleteName}. Times are in your time zone ({timezone.replace("_", " ")}).
      </p>

      <div className="flex flex-wrap items-end gap-3">
        <label className="block">
          <span className="font-body text-xs text-steel block mb-1">{rows.length > 1 ? "Starting" : "First session"}</span>
          <input type="date" value={startDateKey} onChange={(e) => setStartDateKey(e.target.value)} className={inputClass} />
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
            className={`w-24 ${inputClass}`}
          />
        </label>
      </div>

      <div className="space-y-2" role="group" aria-label="Days each week">
        {rows.map((r, i) => (
          <div key={r.id} className="flex flex-wrap items-end gap-3">
            <label className="block">
              <span className="font-body text-xs text-steel block mb-1">{i === 0 ? "Day" : `Day ${i + 1}`}</span>
              <select
                value={rowWeekday(startDateKey, r.weekday)}
                onChange={(e) => updateRow(r.id, { weekday: Number(e.target.value) })}
                aria-label={`Day ${i + 1} of the week`}
                className={inputClass}
              >
                {WEEKDAYS.map((name, d) => (
                  <option key={name} value={d}>
                    {name}
                  </option>
                ))}
              </select>
            </label>
            <label className="block">
              <span className="font-body text-xs text-steel block mb-1">Time</span>
              <input type="time" value={r.time} onChange={(e) => updateRow(r.id, { time: e.target.value })} aria-label={`Time for day ${i + 1}`} className={inputClass} />
            </label>
            {rows.length > 1 && (
              <button type="button" onClick={() => removeRow(r.id)} aria-label={`Remove day ${i + 1}`} className="min-h-11 px-2 font-body text-xs text-steel underline">
                Remove
              </button>
            )}
          </div>
        ))}
        {rows.length < 7 && (
          <button type="button" onClick={addRow} className="font-body text-sm text-rust underline underline-offset-2">
            Add another day
          </button>
        )}
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
          <input type="radio" name="series-mode" className="mt-1" checked={mode === "runout"} onChange={() => setMode("runout")} />
          <span>
            Until their sessions run out
            <span className="block text-xs text-steel">
              {sessionsToBook == null
                ? "Books as many dates as they have sessions left to book, up to 52 weeks."
                : `${sessionsToBook} ${sessionsToBook === 1 ? "session" : "sessions"} left to book: books that many dates, up to 52 weeks.`}
            </span>
          </span>
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
          {loading ? "Checking your calendar…" : shown.length > 0 ? `${bookableCount} of ${shown.length} dates will be booked` : "Dates"}
        </p>
        {previewError && (
          <p className="font-body text-sm text-rust" role="alert">
            {previewError}
          </p>
        )}
        {mode === "runout" && !loading && sessionsToBook === 0 && (
          <p className="font-body text-sm text-steel">They have no sessions left to book. Add some first, or pick a number of weeks.</p>
        )}
        {shown.length > 0 && (
          <ul className="max-h-64 overflow-y-auto divide-y divide-steel/15 border border-steel/20">
            {shown.map((r) => {
              const ticked = !r.blocking && bookedSet.has(r.startIso);
              const detail = labelByIso.get(r.startIso);
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
                  {detail?.conflictLabel && (
                    <span className={`font-body text-xs ${r.blocking ? "text-rust" : "text-steel"}`}>{detail.conflictLabel}</span>
                  )}
                </li>
              );
            })}
          </ul>
        )}
        {mode === "ongoing" && shown.length > 0 && (
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
          disabled={busy || loading || bookableCount === 0 || !!previewError}
          className="bg-rust text-graphite font-display font-bold uppercase tracking-wide px-4 py-2 disabled:opacity-40"
        >
          {busy ? "Booking…" : `Book ${bookableCount} ${bookableCount === 1 ? "session" : "sessions"}`}
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
