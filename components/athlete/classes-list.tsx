"use client";

import { confirmDialog } from "@/components/shared/confirm-dialog";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { formatInTimezone } from "@/lib/format-in-timezone";
import { classSummaryLine, joinView, type AttendeeStatus } from "@/lib/group-sessions";

export interface ClassCard {
  id: string;
  title: string;
  startIso: string;
  endIso: string;
  capacity: number;
  joined: number;
  waitlisted: number;
  locationNote: string | null;
  mine: AttendeeStatus | null;
  cancelled: boolean;
}

// A client's view of the coach's small-group sessions: spots left, one tap to join (or the waiting list when it is full), and
// leave. The database decides who gets the last spot; this just asks and shows what happened.
export function ClassesList({ classes, balance, timezone, nowIso }: { classes: ClassCard[]; balance: number | null; timezone: string; nowIso: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState<string | null>(null);
  const [message, setMessage] = useState<{ id: string; text: string; error: boolean } | null>(null);
  const now = new Date(nowIso);

  async function act(id: string, action: "join" | "leave") {
    if (action === "leave" && !(await confirmDialog({ message: "Leave this group session?", confirmLabel: "Leave", cancelLabel: "Stay" }))) return;
    setBusy(id);
    setMessage(null);
    try {
      const res = await fetch(`/api/group-sessions/${id}`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ action }) });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setMessage({ id, text: data.error ?? "That didn't work.", error: true });
        return;
      }
      if (action === "join") setMessage({ id, text: data.status === "waitlisted" ? "You're on the waiting list." : "You're in.", error: false });
      router.refresh();
    } catch {
      setMessage({ id, text: "That didn't work. Check your connection and try again.", error: true });
    } finally {
      setBusy(null);
    }
  }

  if (classes.length === 0) {
    return <p className="font-body text-sm text-steel">No group sessions are scheduled right now.</p>;
  }

  return (
    <ul className="space-y-3">
      {classes.map((c) => {
        const view = joinView({ capacity: c.capacity, joined: c.joined, mine: c.mine, balance, started: new Date(c.startIso) <= now, cancelled: c.cancelled });
        return (
          <li key={c.id} className="border border-steel/25 p-4">
            <p className="font-body text-base text-chalk">{c.title}</p>
            <p className="font-body text-sm text-steel mt-0.5">{formatInTimezone(new Date(c.startIso), timezone, "dateTime")}</p>
            <p className="font-body text-xs text-steel mt-1">
              {classSummaryLine({ capacity: c.capacity, joined: c.joined, waitlisted: c.waitlisted })}
              {c.locationNote ? ` · ${c.locationNote}` : ""}
            </p>
            <div className="mt-3 flex flex-wrap items-center gap-3">
              {view.action !== "none" ? (
                <button
                  type="button"
                  disabled={busy !== null || view.disabled}
                  onClick={() => act(c.id, view.action === "leave" ? "leave" : "join")}
                  className={
                    view.action === "leave"
                      ? "min-h-11 border border-steel/40 text-chalk font-body text-sm px-4 disabled:opacity-40"
                      : "min-h-11 bg-rust text-graphite font-display font-bold uppercase tracking-wide px-4 disabled:opacity-40"
                  }
                >
                  {busy === c.id ? "One moment…" : view.label}
                </button>
              ) : (
                <span className="font-body text-sm text-steel">{view.label}</span>
              )}
              {view.note && <span className="font-body text-xs text-steel">{view.note}</span>}
            </div>
            {message?.id === c.id && (
              <p className={`font-body text-xs mt-2 ${message.error ? "text-rust" : "text-chalk"}`} role={message.error ? "alert" : "status"}>
                {message.text}
              </p>
            )}
          </li>
        );
      })}
    </ul>
  );
}
