"use client";

import { useState } from "react";
import { graduatedByYear } from "@/lib/graduation";

// On a retired season's Team page: email the graduating players their training history (again). Anyone already sent to is skipped; anyone it failed for is tried again; a player with no usable address stays listed with
// the reason so the coach can get their history to them another way.
export function GraduationSendAgain({ groupId }: { groupId: string }) {
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  const [problems, setProblems] = useState<{ name: string; why: string }[]>([]);

  async function run() {
    setBusy(true);
    setNote(null);
    try {
      const res = await fetch("/api/season/graduate", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ groupId, year: graduatedByYear() }) });
      const d = await res.json().catch(() => ({}));
      if (!res.ok) {
        setNote(d.error ?? "Couldn't send. Try again.");
        setProblems([]);
      } else if (d.emailOff) {
        setNote("Email is not set up, so nothing was sent.");
        setProblems([]);
      } else {
        setProblems(Array.isArray(d.problems) ? d.problems : []);
        const parts = [`${d.sent ?? 0} emailed now`];
        if (d.skipped) parts.push(`${d.skipped} had already been sent theirs`);
        if (d.remaining) parts.push(`${d.remaining} still waiting: press the button again`);
        setNote(parts.join(", ") + ".");
      }
    } catch {
      setNote("Couldn't send. Try again.");
    }
    setBusy(false);
  }

  return (
    <div className="mb-6">
      <button type="button" onClick={run} disabled={busy} className="h-10 px-4 border border-steel/40 text-chalk font-body text-sm disabled:opacity-40">
        {busy ? "Sending…" : "Email graduating players their history"}
      </button>
      <p className="font-body text-xs text-steel mt-1">Sends each graduating player who was not brought into the next season a PDF of their own training history, to their own address only. Anyone already sent theirs is skipped.</p>
      {note && <p className="font-body text-sm mt-2">{note}</p>}
      {problems.length > 0 && (
        <ul className="mt-2 space-y-1">
          {problems.map((p) => (
            <li key={p.name + p.why} className="font-body text-xs text-rust">
              {p.name}: {p.why}.
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
