"use client";

import { useState } from "react";
import { createBrowserClient } from "@/lib/supabase/client";
import { MAX_CAP, type BookingLimits } from "@/lib/session-caps";

const INPUT = "h-11 w-24 bg-graphite border border-steel/30 text-chalk px-3 font-body text-sm focus:outline-none focus:border-rust";
const TIME = "h-11 bg-graphite border border-steel/30 text-chalk px-2 font-body text-sm focus:outline-none focus:border-rust";

// Calendar > Availability (Ron, Oct 23): "I need to limit my weekly sessions at 25. I can't go over 100 sessions a month" and "it would recommend the most likely places that I would want to be
// booked at, which would be around another session or not on my lunch break". All optional; blank = no limit. The database enforces them for a client booking or moving (a coach can always
// book: past a cap, the calendar says so).
export function SessionLimitsControl({ coachId, initial }: { coachId: string; initial: BookingLimits }) {
  const [week, setWeek] = useState(initial.maxPerWeek?.toString() ?? "");
  const [month, setMonth] = useState(initial.maxPerMonth?.toString() ?? "");
  const [together, setTogether] = useState(initial.keepTogether);
  const [lunchStart, setLunchStart] = useState(initial.lunchStart?.slice(0, 5) ?? "");
  const [lunchEnd, setLunchEnd] = useState(initial.lunchEnd?.slice(0, 5) ?? "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  function cap(raw: string, label: string): number | null | string {
    const t = raw.trim();
    if (t === "") return null;
    const n = Number(t);
    if (!Number.isInteger(n) || n < 1 || n > MAX_CAP) return `${label} must be a whole number from 1 to ${MAX_CAP}, or blank for no limit.`;
    return n;
  }

  async function save() {
    setError(null);
    setSaved(false);
    const w = cap(week, "Most sessions per week");
    const m = cap(month, "Most sessions per month");
    if (typeof w === "string") return setError(w);
    if (typeof m === "string") return setError(m);
    if ((lunchStart === "") !== (lunchEnd === "")) return setError("Give the lunch break a start and an end, or leave both blank.");
    if (lunchStart && lunchEnd && lunchStart >= lunchEnd) return setError("The lunch break has to end after it starts.");
    setBusy(true);
    const { error: saveError } = await createBrowserClient()
      .from("coach_booking_policies")
      .upsert(
        { coach_id: coachId, max_sessions_per_week: w, max_sessions_per_month: m, keep_together: together, lunch_start: lunchStart || null, lunch_end: lunchEnd || null },
        { onConflict: "coach_id" }
      );
    setBusy(false);
    if (saveError) return setError("That didn't save. Try again.");
    setSaved(true);
    setTimeout(() => setSaved(false), 2500);
  }

  return (
    <section className="mb-6 max-w-2xl" aria-labelledby="session-limits" data-session-limits>
      <div className="flex items-baseline gap-3 mb-2">
        <h2 id="session-limits" className="font-display uppercase text-lg tracking-wide">
          Limits
        </h2>
        {saved && (
          <span className="font-body text-xs text-positive" role="status">
            Saved
          </span>
        )}
      </div>
      <div className="grid sm:grid-cols-2 gap-3">
        <label className="block">
          <span className="block font-body text-sm text-chalk">Most sessions per week</span>
          <input type="number" inputMode="numeric" min={1} max={MAX_CAP} value={week} onChange={(e) => setWeek(e.target.value)} placeholder="No limit" className={INPUT} />
        </label>
        <label className="block">
          <span className="block font-body text-sm text-chalk">Most sessions per month</span>
          <input type="number" inputMode="numeric" min={1} max={MAX_CAP} value={month} onChange={(e) => setMonth(e.target.value)} placeholder="No limit" className={INPUT} />
        </label>
      </div>
      <p className="font-body text-xs text-steel mt-1">When a week or month is full, clients see no open times for it. You can still schedule anyone; the calendar tells you when you are at or over.</p>

      <label className="mt-4 flex items-start justify-between gap-3">
        <span className="font-body text-sm text-chalk">
          Keep my sessions together
          <span className="block font-body text-xs text-steel mt-0.5">
            Clients are offered only the times right before or after a session already booked that day, and the first 2 times on an empty day. They can still ask for a different time.
          </span>
        </span>
        <input type="checkbox" checked={together} onChange={(e) => setTogether(e.target.checked)} aria-label="Keep my sessions together" className="w-5 h-5 shrink-0 mt-0.5 accent-rust" />
      </label>

      <div className="mt-4">
        <span className="block font-body text-sm text-chalk">Lunch break</span>
        <div className="flex items-center gap-2 mt-1">
          <input type="time" value={lunchStart} onChange={(e) => setLunchStart(e.target.value)} aria-label="Lunch break starts" className={TIME} />
          <span className="font-body text-sm text-steel">to</span>
          <input type="time" value={lunchEnd} onChange={(e) => setLunchEnd(e.target.value)} aria-label="Lunch break ends" className={TIME} />
        </div>
        <p className="font-body text-xs text-steel mt-1">Never offered to clients. Leave blank for none.</p>
      </div>

      <div className="mt-4 flex items-center gap-3">
        <button type="button" onClick={save} disabled={busy} className="h-11 px-5 bg-rust text-graphite font-body text-sm font-medium disabled:opacity-40">
          {busy ? "Saving…" : "Save limits"}
        </button>
      </div>
      {error && (
        <p className="font-body text-xs text-rust mt-2" role="alert">
          {error}
        </p>
      )}
    </section>
  );
}
