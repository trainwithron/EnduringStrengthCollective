"use client";

import { useState } from "react";

// On a retired season's Team page: email the graduating players their training history (again). Anyone already sent theirs is skipped; anyone it failed for is tried again; a player with no usable address stays listed
// with the reason so the coach can get their history to them another way. A player whose earlier send is doubtful (the app may have died between sending and noting it) is never sent to automatically: the coach
// chooses "Send anyway" for that player, knowing they may get two.
export function GraduationSendAgain({ groupId }: { groupId: string }) {
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  const [problems, setProblems] = useState<{ name: string; why: string }[]>([]);
  const [uncertain, setUncertain] = useState<{ id: string; name: string }[]>([]);

  async function call(sendAnyway?: string) {
    setBusy(true);
    setNote(null);
    try {
      const res = await fetch("/api/season/graduate", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(sendAnyway ? { groupId, sendAnyway } : { groupId }) });
      const d = await res.json().catch(() => ({}));
      if (!res.ok) {
        setNote(d.error ?? "Couldn't send. Try again.");
      } else if (d.emailOff) {
        setNote("Email is not set up, so nothing was sent.");
        setProblems([]);
        setUncertain([]);
      } else {
        setProblems(Array.isArray(d.problems) ? d.problems : []);
        setUncertain(Array.isArray(d.uncertain) ? d.uncertain : []);
        const parts = [`${d.sent ?? 0} emailed now`];
        if (d.skipped) parts.push(`${d.skipped} had already been sent theirs or are being sent`);
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
      <button type="button" onClick={() => call()} disabled={busy} className="h-10 px-4 border border-steel/40 text-chalk font-body text-sm disabled:opacity-40">
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
      {uncertain.length > 0 && (
        <div className="mt-3 border border-steel/25 p-3">
          <p className="font-body text-xs text-steel">These players may already have been sent their history (the app could not confirm it). Sending again could give them two copies.</p>
          <ul className="mt-2 space-y-2">
            {uncertain.map((u) => (
              <li key={u.id} className="flex items-center gap-3 font-body text-sm">
                <span className="flex-1 truncate">{u.name}</span>
                <button type="button" onClick={() => call(u.id)} disabled={busy} className="text-xs text-rust underline disabled:opacity-40">
                  Send anyway
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
