"use client";

import { useState } from "react";
import Link from "next/link";
import { coachBalanceLabel } from "@/lib/reup";
import type { NeedsPaymentRow } from "@/lib/dashboard-data";

// Clients who have run out of sessions, most owed first, with a one-tap Remind (a push to the client, at most once every 3 days)
// and Hold (comped, on a break, pays another way: out of the count, never reminded). Shows nothing when everyone has sessions.
export function NeedsPaymentPanel({ rows }: { rows: NeedsPaymentRow[] }) {
  const [list, setList] = useState(rows);
  const [busy, setBusy] = useState<string | null>(null);
  const [note, setNote] = useState<{ id: string; text: string; error: boolean } | null>(null);
  const [showAll, setShowAll] = useState(false);

  if (list.length === 0) return null;
  const visible = showAll ? list : list.slice(0, 5);

  async function act(row: NeedsPaymentRow, action: "remind" | "hold") {
    setBusy(row.athleteId);
    setNote(null);
    try {
      const res = await fetch(action === "remind" ? "/api/reup/remind" : "/api/reup/hold", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(action === "remind" ? { groupId: row.groupId, athleteId: row.athleteId } : { groupId: row.groupId, athleteId: row.athleteId, hold: true }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setNote({ id: row.athleteId, text: data.error ?? "That didn't work.", error: true });
        return;
      }
      if (action === "hold") setList((prev) => prev.filter((r) => r.athleteId !== row.athleteId));
      else setNote({ id: row.athleteId, text: data.message ?? "Reminder sent.", error: false });
    } catch {
      setNote({ id: row.athleteId, text: "That didn't work. Try again.", error: true });
    } finally {
      setBusy(null);
    }
  }

  return (
    <section className="border border-steel/25 bg-surface p-4 mb-6" aria-label="Needs payment">
      <h2 className="font-display uppercase text-sm tracking-wide text-steel mb-3">Needs payment ({list.length})</h2>
      <ul className="divide-y divide-steel/15">
        {visible.map((r) => (
          <li key={r.athleteId} className="py-2.5">
            <div className="flex flex-wrap items-center gap-x-4 gap-y-1">
              <Link href={`/groups/${r.groupId}/athletes/${r.athleteId}`} className="font-body text-sm text-chalk flex-1 min-w-[8rem] truncate hover:underline">
                {r.name}
              </Link>
              <span className="font-body text-xs text-rust">{coachBalanceLabel(r.balance)}</span>
              <button type="button" disabled={busy === r.athleteId} onClick={() => act(r, "remind")} className="font-body text-xs text-chalk underline disabled:opacity-40">
                Remind
              </button>
              <button type="button" disabled={busy === r.athleteId} onClick={() => act(r, "hold")} className="font-body text-xs text-steel underline disabled:opacity-40">
                Hold
              </button>
            </div>
            {note?.id === r.athleteId && (
              <p className={`font-body text-xs mt-1 ${note.error ? "text-rust" : "text-steel"}`} role={note.error ? "alert" : "status"}>
                {note.text}
              </p>
            )}
          </li>
        ))}
      </ul>
      {list.length > 5 && (
        <button type="button" onClick={() => setShowAll((v) => !v)} className="font-body text-xs text-steel underline mt-2">
          {showAll ? "Show fewer" : `Show all ${list.length}`}
        </button>
      )}
    </section>
  );
}
