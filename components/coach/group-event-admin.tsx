"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { confirmDialog } from "@/components/shared/confirm-dialog";
import { formatInTimezone } from "@/lib/format-in-timezone";

export interface EventPerson {
  athleteId: string;
  name: string;
  status: string;
}

// One group event on the Group calendar: when and where, who is In, Out and waiting, who was there (marking attendance), and cancelling it. Nothing here moves a session.
export function GroupEventAdmin({
  event,
  people,
  timezone,
}: {
  event: { id: string; title: string; startAt: string; status: string; place: string | null; note: string | null; capacity: number | null };
  people: EventPerson[];
  timezone: string;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const started = new Date(event.startAt).getTime() <= Date.now();
  const cancelled = event.status === "cancelled";
  const inPeople = people.filter((p) => p.status === "joined" || p.status === "attended");
  const out = people.filter((p) => p.status === "cancelled");
  const waiting = people.filter((p) => p.status === "waitlisted");

  async function act(body: Record<string, unknown>) {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/group-events/${event.id}`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error ?? "That didn't work. Try again.");
      router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "That didn't work. Try again.");
    } finally {
      setBusy(false);
    }
  }

  async function cancel() {
    if (!(await confirmDialog({ message: `Cancel ${event.title}? Everyone who answered is told. Nothing is charged or returned.`, confirmLabel: "Cancel event" }))) return;
    await act({ action: "cancel" });
  }

  return (
    <li className="border border-steel/25 bg-surface p-3" data-testid="group-event-admin">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="font-display uppercase text-sm tracking-wide text-chalk">{event.title}</p>
          <p className="font-body text-xs text-steel">
            {formatInTimezone(new Date(event.startAt), timezone, "dateTime")}
            {event.place ? ` · ${event.place}` : ""}
            {event.capacity ? ` · ${event.capacity} spots` : ""}
          </p>
          {event.note && <p className="font-body text-xs text-steel mt-1">{event.note}</p>}
        </div>
        {cancelled ? (
          <span className="font-body text-xs text-rust uppercase tracking-wide">Cancelled</span>
        ) : (
          !started && (
            <button type="button" onClick={cancel} disabled={busy} className="font-body text-xs text-rust underline underline-offset-2 disabled:opacity-40">
              Cancel event
            </button>
          )
        )}
      </div>

      {!cancelled && (
        <div className="mt-3 font-body text-sm text-chalk">
          <p>
            {inPeople.length} in{waiting.length > 0 ? `, ${waiting.length} waiting` : ""}, {out.length} out
          </p>
          {inPeople.length > 0 && (
            <ul className="mt-1 space-y-1">
              {inPeople.map((p) => (
                <li key={p.athleteId} className="flex items-center gap-2">
                  {started ? (
                    <label className="flex items-center gap-2 min-h-8">
                      <input
                        type="checkbox"
                        checked={p.status === "attended"}
                        disabled={busy}
                        onChange={(e) => void act({ action: "attended", athleteId: p.athleteId, attended: e.target.checked })}
                      />
                      <span>{p.name}</span>
                      <span className="text-xs text-steel">{p.status === "attended" ? "was there" : "mark as there"}</span>
                    </label>
                  ) : (
                    <span>{p.name}</span>
                  )}
                </li>
              ))}
            </ul>
          )}
          {out.length > 0 && <p className="text-xs text-steel mt-2">Out: {out.map((p) => p.name).join(", ")}</p>}
          {waiting.length > 0 && <p className="text-xs text-steel mt-1">Waiting: {waiting.map((p) => p.name).join(", ")}</p>}
        </div>
      )}
      {error && (
        <p className="font-body text-xs text-rust mt-2" role="alert">
          {error}
        </p>
      )}
    </li>
  );
}
