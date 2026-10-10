"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { zonedTimeToUtc } from "@/lib/timezone";
import { eventProblem } from "@/lib/group-events";
import { useTerm } from "@/components/coach/terminology-provider";

// Add a group event: a title, a day and time, an optional place and note, and an optional number of spots. It costs nobody a session. The group hears about it once
// (one announcement in their feed with In and Out buttons, one notification each). The group is always shown: picked here on the Calendar, fixed on a Group calendar.
export function GroupEventForm({
  groups,
  fixedGroupId,
  timezone,
  onDone,
}: {
  groups: { id: string; name: string }[];
  fixedGroupId?: string;
  timezone: string;
  onDone?: () => void;
}) {
  const router = useRouter();
  const term = useTerm();
  const [groupId, setGroupId] = useState(fixedGroupId ?? (groups.length === 1 ? groups[0].id : ""));
  const [title, setTitle] = useState("");
  const [date, setDate] = useState("");
  const [time, setTime] = useState("09:00");
  const [length, setLength] = useState("120");
  const [place, setPlace] = useState("");
  const [note, setNote] = useState("");
  const [spots, setSpots] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);

  const groupWord = term("group");
  const chosen = groups.find((g) => g.id === groupId);

  async function submit() {
    setError(null);
    if (!groupId) {
      setError(`Pick which ${groupWord} this is for.`);
      return;
    }
    if (!date || !/^\d{2}:\d{2}$/.test(time)) {
      setError("Pick a date and time.");
      return;
    }
    const startIso = zonedTimeToUtc(date, time, timezone).toISOString();
    const capacity = spots.trim() === "" ? null : Number(spots);
    const input = { title, startIso, durationMinutes: Number(length), place, note, capacity };
    const problem = eventProblem(input, new Date());
    if (problem) {
      setError(problem);
      return;
    }
    setBusy(true);
    try {
      const res = await fetch("/api/group-events", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ groupId, ...input }) });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error ?? "That didn't save. Nothing was added.");
      setDone(`Added. ${chosen?.name ?? "The group"} has been told.`);
      setTitle("");
      setPlace("");
      setNote("");
      setSpots("");
      router.refresh();
      onDone?.();
    } catch (e) {
      setError(e instanceof Error ? e.message : "That didn't save. Nothing was added.");
    } finally {
      setBusy(false);
    }
  }

  const field = "h-9 bg-graphite border border-steel/30 text-chalk px-2 font-body text-sm";
  return (
    <div className="border border-steel/25 bg-surface p-3 space-y-3" aria-label="Add a group event">
      <p className="font-display uppercase text-xs tracking-wide text-steel">
        Add a {groupWord} event
        {chosen ? <span className="text-chalk"> for {chosen.name}</span> : null}
      </p>
      {!fixedGroupId && groups.length !== 1 && (
        <label className="block font-body text-xs text-steel">
          Which {groupWord}
          <select value={groupId} onChange={(e) => setGroupId(e.target.value)} className={`${field} block w-full mt-1`}>
            <option value="">Pick one</option>
            {groups.map((g) => (
              <option key={g.id} value={g.id}>
                {g.name}
              </option>
            ))}
          </select>
        </label>
      )}
      <label className="block font-body text-xs text-steel">
        Name
        <input value={title} onChange={(e) => setTitle(e.target.value)} maxLength={80} placeholder="Gym workout, then lunch" className={`${field} block w-full mt-1`} />
      </label>
      <div className="flex flex-wrap gap-3">
        <label className="font-body text-xs text-steel">
          Day
          <input type="date" value={date} onChange={(e) => setDate(e.target.value)} className={`${field} block mt-1`} />
        </label>
        <label className="font-body text-xs text-steel">
          Start
          <input type="time" value={time} onChange={(e) => setTime(e.target.value)} className={`${field} block mt-1`} />
        </label>
        <label className="font-body text-xs text-steel">
          Length (min)
          <input type="number" min={5} max={1440} step={5} value={length} onChange={(e) => setLength(e.target.value)} className={`${field} block mt-1 w-24`} />
        </label>
        <label className="font-body text-xs text-steel">
          Spots (optional)
          <input type="number" min={1} max={50} value={spots} onChange={(e) => setSpots(e.target.value)} placeholder="No limit" className={`${field} block mt-1 w-24`} />
        </label>
      </div>
      <label className="block font-body text-xs text-steel">
        Place (optional)
        <input value={place} onChange={(e) => setPlace(e.target.value)} maxLength={200} className={`${field} block w-full mt-1`} />
      </label>
      <label className="block font-body text-xs text-steel">
        Note (optional)
        <textarea value={note} onChange={(e) => setNote(e.target.value)} maxLength={500} rows={2} className={`${field} block w-full mt-1 h-auto py-1.5`} />
      </label>
      <p className="font-body text-xs text-steel">Costs no session. Members answer In or Out. Times are in your time zone ({timezone.replace("_", " ")}).</p>
      {error && (
        <p className="font-body text-xs text-rust" role="alert">
          {error}
        </p>
      )}
      {done && (
        <p className="font-body text-xs text-positive" role="status">
          {done}
        </p>
      )}
      <button type="button" onClick={submit} disabled={busy} className="bg-rust text-graphite font-display font-bold uppercase tracking-wide px-4 py-2 disabled:opacity-40">
        {busy ? "Adding…" : "Add event"}
      </button>
    </div>
  );
}
