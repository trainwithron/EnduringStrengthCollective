"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

// The coach's way to delete a client completely. Removing someone from a group only takes them out of that group; this
// erases the account. The typed name is checked again on the server.
export function DeleteClientControl({
  groupId,
  athleteId,
  athleteName,
}: {
  groupId: string;
  athleteId: string;
  athleteName: string;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [typed, setTyped] = useState("");
  const [eraseHistory, setEraseHistory] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit() {
    if (busy) return;
    setBusy(true);
    setError(null);
    const res = await fetch("/api/clients/delete", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ groupId, athleteId, confirmName: typed, eraseHistory }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      setError(data.error ?? "Couldn't delete this client. Nothing was deleted.");
      setBusy(false);
      return;
    }
    // A one-on-one space that held only this client is gone too, so there is no page to come back to.
    const spaceGone = Array.isArray(data.deletedGroupIds) && data.deletedGroupIds.includes(groupId);
    router.push(spaceGone ? "/dashboard" : `/groups/${groupId}/clients`);
    router.refresh();
  }

  if (!open) {
    return (
      <div>
        <h2 className="font-display uppercase text-sm tracking-wide text-steel mb-1">Delete client</h2>
        <p className="font-body text-xs text-steel mb-2 max-w-[60ch]">
          Removing someone from a group only takes them out of that group. Delete erases {athleteName}&apos;s account completely.
        </p>
        <button type="button" onClick={() => setOpen(true)} className="font-body text-sm text-rust underline underline-offset-2">
          Delete {athleteName}…
        </button>
      </div>
    );
  }

  return (
    <div className="border border-rust/40 bg-rust/5 p-4 max-w-lg space-y-3">
      <h2 className="font-display uppercase text-sm tracking-wide text-chalk">Delete {athleteName} completely</h2>
      <div className="font-body text-xs text-chalk space-y-2">
        <p>
          <span className="font-medium">Erased for good:</span> their account and login, profile, group memberships, messages, posts, check-ins,
          habits, weight, photos, goals, intake and waiver records, session balance, and their personal programs. Their one-on-one space goes too.
        </p>
        <p>
          <span className="font-medium">Kept, with no name on it:</span> payment records (they are financial records) and the audit log
          of admin changes. Unless you tick the box below, their logged workouts and your notes about them stay too, so your totals and
          business numbers do not change.
        </p>
        <p className="text-rust">This can&apos;t be undone. If they have a live subscription, cancel it first.</p>
      </div>
      <label className="flex items-start gap-2 font-body text-xs text-chalk cursor-pointer">
        <input type="checkbox" checked={eraseHistory} onChange={(e) => setEraseHistory(e.target.checked)} className="mt-0.5 w-4 h-4 accent-rust" />
        Also erase their logged workouts and my notes about them
      </label>
      <label className="block">
        <span className="font-body text-xs text-steel">Type {athleteName} to confirm</span>
        <input
          value={typed}
          onChange={(e) => setTyped(e.target.value)}
          className="w-full h-10 mt-1 bg-graphite border border-steel/30 text-chalk px-2 font-body text-sm focus:outline-none focus:border-rust"
          autoComplete="off"
        />
      </label>
      {error && (
        <p className="font-body text-xs text-rust" role="alert">
          {error}
        </p>
      )}
      <div className="flex items-center gap-3">
        <button
          type="button"
          onClick={submit}
          disabled={busy || typed.trim().toLowerCase() !== athleteName.trim().toLowerCase()}
          className="h-10 px-4 bg-rust text-graphite font-display uppercase text-sm font-bold disabled:opacity-40"
        >
          {busy ? "Deleting…" : "Delete for good"}
        </button>
        <button
          type="button"
          onClick={() => {
            setOpen(false);
            setTyped("");
            setError(null);
          }}
          className="font-body text-sm text-steel underline"
        >
          Cancel
        </button>
      </div>
    </div>
  );
}
