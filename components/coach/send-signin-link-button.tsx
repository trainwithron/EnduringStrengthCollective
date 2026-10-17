"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

// For a client who has signed in before and cannot get back in: emails THEM a link to set a new password and sign in. The coach never sees the link.
export function SendSignInLinkButton({ groupId, athleteId, clientName }: { groupId: string; athleteId: string; clientName: string }) {
  const [busy, setBusy] = useState(false);
  const router = useRouter();
  const [note, setNote] = useState<{ message: string; link: string | null } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  async function copy() {
    if (!note?.link) return;
    try {
      await navigator.clipboard.writeText(note.link);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // the field is selectable, so the link can still be copied by hand
    }
  }

  async function send() {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/clients/resend-access", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ groupId, athleteId }) });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || "That didn't work. Try again.");
      setCopied(false);
      setNote({ message: typeof data.message === "string" ? data.message : "Sent.", link: typeof data.link === "string" ? data.link : null });
      router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "That didn't work. Try again.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="mt-4">
      <h3 className="font-body text-sm text-chalk">Can&apos;t get in?</h3>
      <p className="font-body text-xs text-steel mt-0.5">Resend {clientName}&apos;s invite. A link to set a password and sign in goes to their own email address; you never see it. You can send it again at any time.</p>
      {note && (
        <div className="mt-2" role="status">
          <p className="font-body text-sm text-positive">{note.message}</p>
          {note.link && (
            <div className="mt-2 flex items-center gap-2">
              <input readOnly value={note.link} aria-label={`Sign-in link for ${clientName}`} onFocus={(e) => e.currentTarget.select()} className="flex-1 min-w-0 h-11 px-3 bg-graphite border border-steel/40 text-chalk font-body text-xs" />
              <button type="button" onClick={copy} className="h-11 px-4 border border-steel/40 text-chalk font-body text-sm shrink-0">
                {copied ? "Copied" : "Copy"}
              </button>
            </div>
          )}
        </div>
      )}
      <button type="button" onClick={send} disabled={busy} className="h-11 px-4 mt-2 border border-steel/40 text-chalk font-body text-sm disabled:opacity-50">
        {busy ? "Sending…" : note ? "Send it again" : "Resend invite / sign-in link"}
      </button>
      {error && (
        <p className="font-body text-xs text-rust mt-2" role="alert">
          {error}
        </p>
      )}
    </div>
  );
}
