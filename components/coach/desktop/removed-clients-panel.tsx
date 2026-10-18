"use client";

import { useState } from "react";
import { removalLine } from "@/lib/client-removal";

export interface RemovedClient {
  id: string;
  name: string;
  removedAt: string;
  deleteAfter: string | null;
}

// People the coach has taken out of their clients (Release Z1): kept clients can be put back at any time; a client deleted permanently can be put back until the date shown, after which the account is erased.
export function RemovedClientsPanel({ removals }: { removals: RemovedClient[] }) {
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  if (removals.length === 0) return null;

  async function restore(id: string) {
    if (busy) return;
    setBusy(id);
    setError(null);
    try {
      const res = await fetch("/api/clients/restore", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ removalId: id }) });
      const d = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(d.error ?? "Couldn't put them back. Nothing was changed.");
        setBusy(null);
        return;
      }
      window.location.reload();
    } catch {
      setError("Couldn't put them back. Check your connection.");
      setBusy(null);
    }
  }

  return (
    <details className="mt-10 max-w-2xl">
      <summary className="font-body text-sm text-steel cursor-pointer">Removed clients ({removals.length})</summary>
      <ul className="mt-3 border border-steel/20 divide-y divide-steel/15">
        {removals.map((r) => (
          <li key={r.id} className="p-3 flex flex-wrap items-center gap-3">
            <div className="flex-1 min-w-[12rem]">
              <p className="font-body text-sm">{r.name}</p>
              <p className={`font-body text-xs ${r.deleteAfter ? "text-rust" : "text-steel"}`}>{removalLine({ removedAt: r.removedAt, deleteAfter: r.deleteAfter })}</p>
            </div>
            <button type="button" onClick={() => restore(r.id)} disabled={busy !== null} className="min-h-11 px-3 border border-steel/40 font-body text-sm disabled:opacity-40">
              {busy === r.id ? "Putting back…" : "Put back"}
            </button>
          </li>
        ))}
      </ul>
      {error && (
        <p className="font-body text-xs text-rust mt-2" role="alert">
          {error}
        </p>
      )}
    </details>
  );
}
