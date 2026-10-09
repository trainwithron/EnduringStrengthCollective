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

// A coach's small-group sessions: schedule one with a number of spots, see who is in and who is waiting, add or remove people,
// change the spots, mark attendance, cancel. Clients join on their own from their Classes page.
export function GroupSessionsManager({
  groupId,
  timezone,
  classes,
  clients,
  nowIso,
}: {
  groupId: string;
  timezone: string;
  classes: ClassRow[];
  clients: ClientOption[];
  nowIso: string;
}) {
  const router = useRouter();
  const term = useTerm();
  const [title, setTitle] = useState("");
  const [dateKey, setDateKey] = useState(addDaysToDateKey(dateKeyInZone(timezone), 1));
  const [time, setTime] = useState("18:00");
  const [duration, setDuration] = useState(60);
  const [capacity, setCapacity] = useState(6);
  const [place, setPlace] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const [message, setMessage] = useState<{ text: string; error: boolean } | null>(null);
  const [addPick, setAddPick] = useState<Record<string, string>>({});
  const [spots, setSpots] = useState<Record<string, string>>({});

  const now = new Date(nowIso);

  async function run(key: string, fn: () => Promise<{ ok: boolean; message: string }>) {
    setBusy(key);
    setMessage(null);
    const r = await fn();
    setBusy(null);
    if (r.ok) router.refresh();
    else setMessage({ text: r.message, error: true });
    return r.ok;
  }

  async function create(e: React.FormEvent) {
    e.preventDefault();
    const startIso = zonedTimeToUtc(dateKey, time, timezone).toISOString();
    const problem = createProblem({ title, startIso, durationMinutes: duration, capacity, locationNote: place }, now);
    if (problem) {
      setMessage({ text: problem, error: true });
      return;
    }
    const ok = await run("create", () => call("/api/group-sessions", { groupId, title, startIso, durationMinutes: duration, capacity, locationNote: place }));
    if (ok) {
      setTitle("");
      setPlace("");
    }
  }

  const upcoming = classes.filter((c) => c.status === "scheduled" && new Date(c.startIso) >= now);
  const earlier = classes.filter((c) => !(c.status === "scheduled" && new Date(c.startIso) >= now)).reverse();

  function card(c: ClassRow, past: boolean) {
    const inClass = c.attendees.filter((a) => a.status === "joined" || a.status === "attended");
    const waiting = c.attendees.filter((a) => a.status === "waitlisted");
    const taken = new Set(c.attendees.map((a) => a.athleteId));
    const addable = clients.filter((cl) => !taken.has(cl.athleteId));
    const cancelled = c.status === "cancelled";
    return (
      <li key={c.id} className="border border-steel/25 p-4">
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
                    onClick={() => run(`${c.id}-${a.athleteId}-att`, () => call(`/api/group-sessions/${c.id}`, { action: "attended", athleteId: a.athleteId, attended: a.status !== "attended" }))}
                  >
                    {a.status === "attended" ? "Undo attended" : "Mark attended"}
                  </button>
                )}
                {!past && (
                  <button
                    type="button"
                    className="font-body text-xs text-steel underline disabled:opacity-40"
                    disabled={busy !== null}
                    onClick={() => run(`${c.id}-${a.athleteId}-rm`, () => call(`/api/group-sessions/${c.id}`, { action: "leave", athleteId: a.athleteId }))}
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
              <select className={`${input} min-w-[11rem]`} value={addPick[c.id] ?? ""} onChange={(e) => setAddPick((p) => ({ ...p, [c.id]: e.target.value }))}>
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
              disabled={busy !== null || !addPick[c.id]}
              onClick={async () => {
                const ok = await run(`${c.id}-add`, () => call(`/api/group-sessions/${c.id}`, { action: "join", athleteId: addPick[c.id] }));
                if (ok) setAddPick((p) => ({ ...p, [c.id]: "" }));
              }}
            >
              Add
            </button>
            <label className="block">
              <span className="font-body text-xs text-steel block mb-1">Spots</span>
              <input
                className={`${input} w-20`}
                type="number"
                min={1}
                max={50}
                value={spots[c.id] ?? String(c.capacity)}
                onChange={(e) => setSpots((p) => ({ ...p, [c.id]: e.target.value }))}
              />
            </label>
            <button
              type="button"
              className={smallBtn}
              disabled={busy !== null || Number(spots[c.id] ?? c.capacity) === c.capacity}
              onClick={() => run(`${c.id}-cap`, () => call(`/api/group-sessions/${c.id}`, { action: "capacity", capacity: Number(spots[c.id]) }))}
            >
              Change spots
            </button>
            <button
              type="button"
              className="border border-rust text-rust font-body text-xs px-3 py-1.5 disabled:opacity-40 ml-auto"
              disabled={busy !== null}
              onClick={async () => {
                if (await confirmDialog(`Cancel ${c.title}? Everyone is told, and any session they used is returned.`)) {
                  run(`${c.id}-cancel`, () => call(`/api/group-sessions/${c.id}`, { action: "cancel" }));
                }
              }}
            >
              Cancel class
            </button>
          </div>
        )}
      </li>
    );
  }

  return (
    <div className="max-w-3xl space-y-10">
      <section>
        <h2 className="font-display uppercase text-sm tracking-wide text-steel mb-3">New group session</h2>
        <form onSubmit={create} className="border border-steel/25 p-4 space-y-3">
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
          <button type="submit" disabled={busy !== null} className="bg-rust text-graphite font-display font-bold uppercase tracking-wide px-4 py-2 disabled:opacity-40">
            {busy === "create" ? "Scheduling…" : "Schedule"}
          </button>
        </form>
      </section>

      {message && (
        <p className={`font-body text-sm ${message.error ? "text-rust" : "text-chalk"}`} role={message.error ? "alert" : "status"}>
          {message.text}
        </p>
      )}

      <section>
        <h2 className="font-display uppercase text-sm tracking-wide text-steel mb-3">Coming up</h2>
        {upcoming.length === 0 ? <p className="font-body text-sm text-steel">No group sessions scheduled.</p> : <ul className="space-y-3">{upcoming.map((c) => card(c, false))}</ul>}
      </section>

      {earlier.length > 0 && (
        <section>
          <h2 className="font-display uppercase text-sm tracking-wide text-steel mb-3">Earlier</h2>
          <ul className="space-y-3">{earlier.map((c) => card(c, true))}</ul>
        </section>
      )}
    </div>
  );
}
