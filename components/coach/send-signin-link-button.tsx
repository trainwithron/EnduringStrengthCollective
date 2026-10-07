"use client";

import { useState } from "react";

// For a client who has signed in before and cannot get back in: emails THEM a link to set a new password and sign in. The coach never sees the link.
export function SendSignInLinkButton({ groupId, athleteId, clientName }: { groupId: string; athleteId: string; clientName: string }) {
  const [busy, setBusy] = useState(false);
  const [sentTo, setSentTo] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function send() {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/clients/send-signin-link", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ groupId, athleteId }) });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || "That didn't work. Try again.");
      setSentTo(data.sentTo ?? "their email");
    } catch (e) {
      setError(e instanceof Error ? e.message : "That didn't work. Try again.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="mt-4">
      <h3 className="font-body text-sm text-chalk">Can&apos;t get in?</h3>
      <p className="font-body text-xs text-steel mt-0.5">Email {clientName} a link to set a new password and sign in. It goes to their own email address; you never see it.</p>
      {sentTo ? (
        <p className="font-body text-sm text-positive mt-2" role="status">
          Sent to {sentTo}. Ask them to check spam if it does not arrive in a few minutes.
        </p>
      ) : (
        <button type="button" onClick={send} disabled={busy} className="h-11 px-4 mt-2 border border-steel/40 text-chalk font-body text-sm disabled:opacity-50">
          {busy ? "Sending…" : "Email them a sign-in link"}
        </button>
      )}
      {error && (
        <p className="font-body text-xs text-rust mt-2" role="alert">
          {error}
        </p>
      )}
    </div>
  );
}
