"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

// How the coach fixes a client's name (see /api/clients/rename). A client who has not signed in: "Edit name" sets it on the account and the space together. A client who has: their name is theirs, so the only offer is
// to make the space's name match it, shown only when the two differ.
export function ClientNameControl({ groupId, athleteId, profileName, spaceName, oneOnOne, signedIn }: { groupId: string; athleteId: string; profileName: string; spaceName: string; oneOnOne: boolean; signedIn: boolean }) {
  const router = useRouter();
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState(profileName);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function send(payload: Record<string, unknown>) {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/clients/rename", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ groupId, athleteId, ...payload }) });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(data.error ?? "Couldn't save. Try again.");
        setBusy(false);
        return;
      }
      setEditing(false);
      setBusy(false);
      router.refresh();
    } catch {
      setError("Couldn't save. Check your connection and try again.");
      setBusy(false);
    }
  }

  if (signedIn) {
    // Their name is their own. Only the space's label can be brought in line with it.
    if (!oneOnOne || spaceName.trim() === profileName.trim()) return null;
    return (
      <div className="border border-steel/20 p-3 space-y-2" data-name-match>
        <p className="font-body text-sm text-chalk">
          Their space is named &ldquo;{spaceName}&rdquo; but they use &ldquo;{profileName}&rdquo;.
        </p>
        <button type="button" onClick={() => void send({ matchSpace: true })} disabled={busy} className="h-10 px-4 border border-rust text-rust font-body text-sm disabled:opacity-40">
          {busy ? "Saving…" : `Name the space “${profileName}”`}
        </button>
        {error && (
          <p className="font-body text-xs text-rust" role="alert">
            {error}
          </p>
        )}
      </div>
    );
  }

  return (
    <div className="space-y-2" data-name-edit>
      {!editing ? (
        <button type="button" onClick={() => setEditing(true)} className="font-body text-xs text-steel underline underline-offset-2">
          Edit name
        </button>
      ) : (
        <form
          onSubmit={(e) => {
            e.preventDefault();
            void send({ fullName: name });
          }}
          className="flex flex-wrap items-center gap-2"
        >
          <label className="sr-only" htmlFor="client-full-name">
            Full name
          </label>
          <input id="client-full-name" value={name} onChange={(e) => setName(e.target.value)} maxLength={120} className="h-11 min-w-0 flex-1 bg-graphite border border-steel/30 text-chalk px-2 font-body text-base focus:outline-none focus:border-rust" />
          <button type="submit" disabled={busy || !name.trim()} className="h-11 px-4 bg-rust text-graphite font-body text-sm font-medium disabled:opacity-40">
            {busy ? "Saving…" : "Save"}
          </button>
          <button type="button" onClick={() => { setEditing(false); setName(profileName); setError(null); }} className="h-11 px-3 font-body text-xs text-steel">
            Cancel
          </button>
        </form>
      )}
      {error && (
        <p className="font-body text-xs text-rust" role="alert">
          {error}
        </p>
      )}
    </div>
  );
}
