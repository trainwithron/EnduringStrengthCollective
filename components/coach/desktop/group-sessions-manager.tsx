"use client";

import { confirmDialog } from "@/components/shared/confirm-dialog";
import { useState } from "react";
import { useTerm } from "@/components/coach/terminology-provider";
import { useRouter } from "next/navigation";
import { addDaysToDateKey } from "@/lib/series-schedule";
import { dateKeyInZone, zonedTimeToUtc } from "@/lib/timezone";
import { formatInTimezone } from "@/lib/format-in-timezone";
import { classSummaryLine, createProblem } from "@/lib/group-sessions";

export interface ClassAttendee {
  athleteId: string;
  name: string;
  status: "joined" | "waitlisted" | "attended";
  creditTaken: boolean;
  addedByCoach: boolean;
}

export interface ClassRow {
  id: string;
  title: string;
  startIso: string;
  endIso: string;
  capacity: number;
  locationNote: string | null;
  status: "scheduled" | "cancelled";
  attendees: ClassAttendee[];
}

export interface ClientOption {
  athleteId: string;
  name: string;
}

const input = "bg-surface border border-steel/30 text-chalk px-2.5 py-1.5 font-body text-sm focus:outline-none focus:border-rust";
const smallBtn = "border border-steel/40 text-chalk font-body text-xs px-3 py-1.5 disabled:opacity-40";

async function call(url: string, body: unknown): Promise<{ ok: boolean; message: string }> {
  try {
    const res = await fetch(url, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
    const data = await res.json().catch(() => ({}));
    return res.ok ? { ok: true, message: "Done." } : { ok: false, message: data.error ?? "That didn't work." };
  } catch {
    return { ok: false, message: "That didn't work. Check your connection and try again." };
  }
}

// One action at a time, with the page refreshed after it works and a plain message when it doesn't.
function useRun() {
  const router = useRouter();
  const [busy, setBusy] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  async function run(key: string, fn: () => Promise<{ ok: boolean; message: string }>) {
    setBusy(key);
    setMessage(null);
    const r = await fn();
    setBusy(null);
    if (r.ok) router.refresh();
    else setMessage(r.message);
    return r.ok;
  }
  return { busy, message, setMessage, run };
}

// Schedule a small-group session with a number of spots (Group calendar > New > Group session). Clients join on their own from their Group sessions page.
export function GroupSessionForm({ groupId, timezone, nowIso }: { groupId: string; timezone: string; nowIso: string }) {
  const term = useTerm();
  const { busy, message, setMessage, run } = useRun();
  const [title, setTitle] = useState("");
  const [dateKey, setDateKey] = useState(addDaysToDateKey(dateKeyInZone(timezone), 1));
  const [time, setTime] = useState("18:00");
  const [duration, setDuration] = useState(60);
  const [capacity, setCapacity] = useState(6);
  const [place, setPlace] = useState("");

  async function create(e: React.FormEvent) {
    e.preventDefault();
    const startIso = zonedTimeToUtc(dateKey, time, timezone).toISOString();
    const problem = createProblem({ title, startIso, durationMinutes: duration, capacity, locationNote: place }, new Date(nowIso));
    if (problem) {
      setMessage(problem);
      return;
    }
    const ok = await run("create", () => call("/api/group-sessions", { groupId, title, startIso, durationMinutes: duration, capacity, locationNote: place }));
    if (ok) {
      setTitle("");
      setPlace("");
    }
  }

  return (
    <form onSubmit={create} className="border border-steel/25 bg-surface p-3 space-y-3" aria-label="New group session">
      <label className="block">
        <span className="font-body text-xs text-steel block mb-1">Name</span>
        <input className={`${input} w-full`} value={title} onChange={(e) => setTitle(e.target.value)} maxLength={80} placeholder="e.g. Tuesday small group" />
      </label>
      <div className="flex flex-wrap items-end gap-3">
        <label className="block">
          <span className="font-body text-xs text-steel block mb-1">Day</span>
          <input className={input} type="date" value={dateKey} onChange={(e) => setDateKey(e.target.value)} />
        </label>
        <label className="block">
          <span className="font-body text-xs text-steel block mb-1">Time</span>
          <input className={input} type="time" value={time} onChange={(e) => setTime(e.target.value)} />
        </label>
        <label className="block">
          <span className="font-body text-xs text-steel block mb-1">Minutes</span>
          <input className={`${input} w-20`} type="number" min={5} max={480} step={5} value={duration} onChange={(e) => setDuration(Number(e.target.value) || 0)} />
        </label>
        <label className="block">
          <span className="font-body text-xs text-steel block mb-1">Spots</span>
          <input className={`${input} w-20`} type="number" min={1} max={50} value={capacity} onChange={(e) => setCapacity(Number(e.target.value) || 0)} />
        </label>
      </div>
      <label className="block">
        <span className="font-body text-xs text-steel block mb-1">Place (optional)</span>
        <input className={`${input} w-full`} value={place} onChange={(e) => setPlace(e.target.value)} maxLength={200} />
      </label>
      <p className="font-body text-xs text-steel">
        Times are in your time zone ({timezone.replace("_", " ")}). The time is blocked in your calendar. {term("client", "plural", { cap: true })} join with one tap; a {term("client")}
        who joins uses one session. When it is full, the next people go on a waiting list.
      </p>
      {message && (
        <p className="font-body text-xs text-rust" role="alert">
          {message}
        </p>
      )}
      <button type="submit" disabled={busy !== null} className="bg-rust text-graphite font-display font-bold uppercase tracking-wide px-4 py-2 disabled:opacity-40">
        {busy === "create" ? "Scheduling…" : "Schedule"}
      </button>
    </form>
  );
}

// One group session's roster (Group calendar, the card the coach opened): who is in and who is waiting, mark attendance, add or remove people, change the
// spots, cancel.
export function GroupSessionDetail({ cls: c, clients, timezone, nowIso }: { cls: ClassRow; clients: ClientOption[]; timezone: string; nowIso: string }) {
  const term = useTerm();
  const { busy, message, run } = useRun();
  const [addPick, setAddPick] = useState("");
  const [spots, setSpots] = useState(String(c.capacity));
  const past = !(c.status === "scheduled" && new Date(c.startIso) >= new Date(nowIso));
  const inClass = c.attendees.filter((a) => a.status === "joined" || a.status === "attended");
  const waiting = c.attendees.filter((a) => a.status === "waitlisted");
  const taken = new Set(c.attendees.map((a) => a.athleteId));
  const addable = clients.filter((cl) => !taken.has(cl.athleteId));
  const cancelled = c.status === "cancelled";

  return (
    <div className="border border-steel/25 bg-surface p-4">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <p className="font-body text-base text-chalk">
          {c.title} {cancelled && <span className="text-xs text-rust border border-rust/50 px-1.5 py-0.5 ml-1">Cancelled</span>}
        </p>
        <p className="font-body text-sm text-steel">{formatInTimezone(new Date(c.startIso), timezone, "dateTime")}</p>
      </div>
      <p className="font-body text-xs text-steel mt-1">
        {cancelled ? "Cancelled. Anyone charged was refunded." : classSummaryLine({ capacity: c.capacity, joined: inClass.length, waitlisted: waiting.length })}
        {c.locationNote ? ` · ${c.locationNote}` : ""}
      </p>

      {!cancelled && (
        <ul className="mt-3 divide-y divide-steel/15 border border-steel/20">
          {inClass.length === 0 && waiting.length === 0 && <li className="px-3 py-2 font-body text-sm text-steel">Nobody yet.</li>}
          {[...inClass, ...waiting].map((a) => (
            <li key={a.athleteId} className="flex flex-wrap items-center gap-x-3 gap-y-1 px-3 py-2">
              <span className="font-body text-sm text-chalk flex-1 min-w-[8rem]">{a.name}</span>
              <span className="font-body text-xs text-steel">
                {a.status === "waitlisted" ? "Waiting" : a.status === "attended" ? "Attended" : a.creditTaken ? "In, session used" : "In, not charged yet"}
              </span>
              {a.status !== "waitlisted" && (
                <button
                  type="button"
                  className={smallBtn}
                  disabled={busy !== null}
                  onClick={() => run(`${a.athleteId}-att`, () => call(`/api/group-sessions/${c.id}`, { action: "attended", athleteId: a.athleteId, attended: a.status !== "attended" }))}
                >
                  {a.status === "attended" ? "Undo attended" : "Mark attended"}
                </button>
              )}
              {!past && (
                <button
                  type="button"
                  className="font-body text-xs text-steel underline disabled:opacity-40"
                  disabled={busy !== null}
                  onClick={() => run(`${a.athleteId}-rm`, () => call(`/api/group-sessions/${c.id}`, { action: "leave", athleteId: a.athleteId }))}
                >
                  Remove
                </button>
              )}
            </li>
          ))}
        </ul>
      )}

      {!cancelled && !past && (
        <div className="flex flex-wrap items-end gap-3 mt-3">
          <label className="block">
            <span className="font-body text-xs text-steel block mb-1">Add a {term("client")}</span>
            <select className={`${input} min-w-[11rem]`} value={addPick} onChange={(e) => setAddPick(e.target.value)}>
              <option value="">Choose…</option>
              {addable.map((cl) => (
                <option key={cl.athleteId} value={cl.athleteId}>
                  {cl.name}
                </option>
              ))}
            </select>
          </label>
          <button
            type="button"
            className={smallBtn}
            disabled={busy !== null || !addPick}
            onClick={async () => {
              const ok = await run("add", () => call(`/api/group-sessions/${c.id}`, { action: "join", athleteId: addPick }));
              if (ok) setAddPick("");
            }}
          >
            Add
          </button>
          <label className="block">
            <span className="font-body text-xs text-steel block mb-1">Spots</span>
            <input className={`${input} w-20`} type="number" min={1} max={50} value={spots} onChange={(e) => setSpots(e.target.value)} />
          </label>
          <button
            type="button"
            className={smallBtn}
            disabled={busy !== null || Number(spots) === c.capacity}
            onClick={() => run("cap", () => call(`/api/group-sessions/${c.id}`, { action: "capacity", capacity: Number(spots) }))}
          >
            Change spots
          </button>
          <button
            type="button"
            className="border border-rust text-rust font-body text-xs px-3 py-1.5 disabled:opacity-40 ml-auto"
            disabled={busy !== null}
            onClick={async () => {
              if (await confirmDialog(`Cancel ${c.title}? Everyone is told, and any session they used is returned.`)) {
                run("cancel", () => call(`/api/group-sessions/${c.id}`, { action: "cancel" }));
              }
            }}
          >
            Cancel class
          </button>
        </div>
      )}
      {message && (
        <p className="font-body text-xs text-rust mt-2" role="alert">
          {message}
        </p>
      )}
    </div>
  );
}
