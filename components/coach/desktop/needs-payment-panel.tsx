"use client";

import { confirmDialog } from "@/components/shared/confirm-dialog";
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
  const [holdingAll, setHoldingAll] = useState(false);
  const [holdAllNote, setHoldAllNote] = useState<string | null>(null);

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

  // For a coach who bills outside the app (Acuity, cash, a gym): put everyone on this list on hold in one go. A held client leaves the list, is
  // never reminded, and never sees a re-up prompt. Each one can be taken off hold from the Clients page.
  async function holdAll() {
    if (!await confirmDialog(`Put all ${list.length} on hold? They leave this list, are never reminded, and don't see a re-up prompt. You can take a hold off from the Clients page.`)) return;
    setHoldingAll(true);
    setHoldAllNote(null);
    const failed: string[] = [];
    for (const row of list) {
      try {
        const res = await fetch("/api/reup/hold", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ groupId: row.groupId, athleteId: row.athleteId, hold: true }) });
        if (!res.ok) failed.push(row.athleteId);
      } catch {
        failed.push(row.athleteId);
      }
    }
    setList((prev) => prev.filter((r) => failed.includes(r.athleteId)));
    setHoldAllNote(failed.length === 0 ? "Done. Everyone is on hold." : `${failed.length} could not be put on hold. Try those again one by one.`);
    setHoldingAll(false);
  }

  return (
    <section className="border border-steel/25 bg-surface p-4 mb-6" aria-label="Needs payment">
      <div className="flex items-baseline justify-between gap-3 mb-3">
        <h2 className="font-display uppercase text-sm tracking-wide text-steel">Needs payment ({list.length})</h2>
        {list.length > 1 && (
          <button type="button" onClick={holdAll} disabled={holdingAll} className="font-body text-xs text-steel underline disabled:opacity-40">
            {holdingAll ? "Holding…" : "Hold all"}
          </button>
        )}
      </div>
      {holdAllNote && <p className="font-body text-xs text-steel mb-2" role="status">{holdAllNote}</p>}
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
