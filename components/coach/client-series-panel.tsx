"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { SeriesScheduleForm } from "@/components/coach/series-schedule-form";
import { wallClockOf } from "@/lib/series-schedule";
import { zonedTimeToUtc } from "@/lib/timezone";
import { formatInTimezone } from "@/lib/format-in-timezone";

export interface SeriesUpcoming {
  bookingId: string;
  startIso: string;
}

export interface SeriesView {
  id: string;
  mode: "fixed" | "ongoing";
  status: "active" | "paused" | "ended" | "cancelled";
  weekday: number;
  startTime: string;
  durationMinutes: number;
  occurrencesTotal: number | null;
  upcoming: SeriesUpcoming[];
}

const WEEKDAYS = ["Sundays", "Mondays", "Tuesdays", "Wednesdays", "Thursdays", "Fridays", "Saturdays"];

function clock12(hhmm: string): string {
  const [h, m] = hhmm.split(":").map(Number);
  const suffix = h >= 12 ? "PM" : "AM";
  return `${((h + 11) % 12) + 1}:${String(m).padStart(2, "0")} ${suffix}`;
}

async function post(url: string, body: unknown): Promise<{ ok: boolean; message: string }> {
  try {
    const res = await fetch(url, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) return { ok: false, message: data.error ?? data.message ?? "That didn't work." };
    return { ok: true, message: data.message ?? "Done." };
  } catch {
    return { ok: false, message: "That didn't work. Check your connection and try again." };
  }
}

const btn = "border border-steel/40 text-chalk font-body text-xs px-3 py-1.5 disabled:opacity-40";

// A client's recurring schedules: create one, then pause, resume, end or extend it, and change a single session or "this and
// the rest". Every change goes through the server, which books and cancels with the same functions as any other booking.
export function ClientSeriesPanel({
  groupId,
  athleteId,
  athleteName,
  timezone,
  series,
}: {
  groupId: string;
  athleteId: string;
  athleteName: string;
  timezone: string;
  series: SeriesView[];
}) {
  const router = useRouter();
  const [creating, setCreating] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [message, setMessage] = useState<{ text: string; error: boolean } | null>(null);
  const [extendWeeks, setExtendWeeks] = useState<Record<string, string>>({});
  const [open, setOpen] = useState<string | null>(null);
  const [editing, setEditing] = useState<string | null>(null);
  const [editWhen, setEditWhen] = useState("");
  const [editDuration, setEditDuration] = useState("");

  async function run(key: string, url: string, body: unknown) {
    setBusy(key);
    setMessage(null);
    const r = await post(url, body);
    setBusy(null);
    setMessage({ text: r.message, error: !r.ok });
    if (r.ok) {
      setEditing(null);
      router.refresh();
    }
  }

  function startEditing(u: SeriesUpcoming, durationMinutes: number) {
    const w = wallClockOf(new Date(u.startIso), timezone);
    setEditing(u.bookingId);
    setEditWhen(`${w.dateKey}T${w.time}`);
    setEditDuration(String(durationMinutes));
  }

  function editedStartIso(): string | null {
    const [d, t] = editWhen.split("T");
    if (!d || !t) return null;
    return zonedTimeToUtc(d, t.slice(0, 5), timezone).toISOString();
  }

  const running = series.filter((s) => s.status === "active" || s.status === "paused");
  const finished = series.filter((s) => s.status === "ended");

  return (
    <div className="space-y-4">
      <p className="font-body text-xs text-steel">
        Book {athleteName} at the same time every week. Set it up once; pause, extend or end it later.
      </p>

      {running.length === 0 && !creating && <p className="font-body text-sm text-steel">No weekly schedule yet.</p>}

      {running.map((s) => {
        const label = s.mode === "ongoing" ? "no end date" : `${s.occurrencesTotal} weeks`;
        const isOpen = open === s.id;
        return (
          <div key={s.id} className="border border-steel/25 p-3">
            <div className="flex flex-wrap items-center gap-2">
              <p className="font-body text-sm text-chalk">
                {WEEKDAYS[s.weekday]} at {clock12(s.startTime)} <span className="text-steel">· {s.durationMinutes} min · {label}</span>
              </p>
              <span className={`font-body text-xs px-1.5 py-0.5 border ${s.status === "paused" ? "border-steel/40 text-steel" : "border-rust text-rust"}`}>
                {s.status === "paused" ? "Paused" : "Running"}
              </span>
            </div>
            <p className="font-body text-xs text-steel mt-1">
              {s.upcoming.length === 0
                ? "No upcoming sessions."
                : `Next: ${formatInTimezone(new Date(s.upcoming[0].startIso), timezone, "dateTime")} · ${s.upcoming.length} booked ahead`}
            </p>

            <div className="flex flex-wrap items-center gap-2 mt-3">
              {s.status === "active" ? (
                <button type="button" className={btn} disabled={busy !== null} onClick={() => run(`${s.id}-pause`, `/api/series/${s.id}`, { action: "pause" })}>
                  Pause
                </button>
              ) : (
                <button type="button" className={btn} disabled={busy !== null} onClick={() => run(`${s.id}-resume`, `/api/series/${s.id}`, { action: "resume" })}>
                  Resume
                </button>
              )}
              <button
                type="button"
                className={btn}
                disabled={busy !== null}
                onClick={() => {
                  if (window.confirm(`End this weekly schedule and remove the ${s.upcoming.length} upcoming sessions? Sessions that already happened stay.`)) {
                    run(`${s.id}-end`, `/api/series/${s.id}`, { action: "end", cancelUpcoming: true });
                  }
                }}
              >
                End
              </button>
              {s.mode === "fixed" && s.status === "active" && (
                <span className="inline-flex items-center gap-1">
                  <input
                    type="number"
                    min={1}
                    max={52}
                    value={extendWeeks[s.id] ?? ""}
                    onChange={(e) => setExtendWeeks((p) => ({ ...p, [s.id]: e.target.value }))}
                    placeholder="weeks"
                    aria-label="Weeks to add"
                    className="w-20 bg-transparent border border-steel/30 px-2 py-1 font-body text-xs text-chalk"
                  />
                  <button
                    type="button"
                    className={btn}
                    disabled={busy !== null || !extendWeeks[s.id]}
                    onClick={() => run(`${s.id}-extend`, `/api/series/${s.id}`, { action: "extend", weeks: Number(extendWeeks[s.id]) })}
                  >
                    Add weeks
                  </button>
                </span>
              )}
              {s.upcoming.length > 0 && (
                <button type="button" className="font-body text-xs text-steel underline" onClick={() => setOpen(isOpen ? null : s.id)}>
                  {isOpen ? "Hide sessions" : "Edit sessions"}
                </button>
              )}
            </div>

            {isOpen && (
              <ul className="mt-3 divide-y divide-steel/15 border border-steel/20">
                {s.upcoming.slice(0, 12).map((u) => (
                  <li key={u.bookingId} className="px-3 py-2">
                    <div className="flex flex-wrap items-center gap-3">
                      <span className="font-body text-sm text-chalk flex-1 min-w-[10rem]">{formatInTimezone(new Date(u.startIso), timezone, "dateTime")}</span>
                      <button type="button" className="font-body text-xs text-chalk underline" onClick={() => (editing === u.bookingId ? setEditing(null) : startEditing(u, s.durationMinutes))}>
                        Change
                      </button>
                      <button
                        type="button"
                        className="font-body text-xs text-steel underline"
                        disabled={busy !== null}
                        onClick={() => {
                          if (window.confirm("Remove just this session? The schedule carries on.")) run(`${u.bookingId}-skip`, "/api/series/occurrence", { bookingId: u.bookingId, action: "skip" });
                        }}
                      >
                        Remove
                      </button>
                    </div>
                    {editing === u.bookingId && (
                      <div className="mt-2 flex flex-wrap items-end gap-3">
                        <label className="block">
                          <span className="font-body text-xs text-steel block mb-1">New day and time</span>
                          <input
                            type="datetime-local"
                            value={editWhen}
                            onChange={(e) => setEditWhen(e.target.value)}
                            className="bg-transparent border border-steel/30 px-2 py-1 font-body text-sm text-chalk"
                          />
                        </label>
                        <label className="block">
                          <span className="font-body text-xs text-steel block mb-1">Minutes</span>
                          <input
                            type="number"
                            min={5}
                            max={480}
                            step={5}
                            value={editDuration}
                            onChange={(e) => setEditDuration(e.target.value)}
                            className="w-20 bg-transparent border border-steel/30 px-2 py-1 font-body text-sm text-chalk"
                          />
                        </label>
                        <button
                          type="button"
                          className={btn}
                          disabled={busy !== null || !editedStartIso()}
                          onClick={() =>
                            run(`${u.bookingId}-move`, "/api/series/occurrence", {
                              bookingId: u.bookingId,
                              action: "move",
                              newStartIso: editedStartIso(),
                              durationMinutes: Number(editDuration) || null,
                            })
                          }
                        >
                          Just this one
                        </button>
                        <button
                          type="button"
                          className={btn}
                          disabled={busy !== null || !editedStartIso()}
                          onClick={() => {
                            if (window.confirm("Change this session and every one after it to the new day and time?")) {
                              run(`${u.bookingId}-rest`, "/api/series/occurrence", {
                                bookingId: u.bookingId,
                                action: "change_from_here",
                                newStartIso: editedStartIso(),
                                durationMinutes: Number(editDuration) || null,
                              });
                            }
                          }}
                        >
                          This and the rest
                        </button>
                      </div>
                    )}
                  </li>
                ))}
                {s.upcoming.length > 12 && <li className="px-3 py-2 font-body text-xs text-steel">…and {s.upcoming.length - 12} more.</li>}
              </ul>
            )}
          </div>
        );
      })}

      {finished.length > 0 && (
        <p className="font-body text-xs text-steel">{finished.length} earlier {finished.length === 1 ? "schedule has" : "schedules have"} ended.</p>
      )}

      {message && (
        <p className={`font-body text-sm ${message.error ? "text-rust" : "text-chalk"}`} role={message.error ? "alert" : "status"}>
          {message.text}
        </p>
      )}

      {creating ? (
        <div className="border border-steel/25 p-3">
          <SeriesScheduleForm
            groupId={groupId}
            athleteId={athleteId}
            athleteName={athleteName}
            timezone={timezone}
            onCancel={() => setCreating(false)}
          />
        </div>
      ) : (
        <button type="button" onClick={() => setCreating(true)} className="bg-rust text-graphite font-display font-bold uppercase tracking-wide px-4 py-2">
          New weekly schedule
        </button>
      )}
    </div>
  );
}
