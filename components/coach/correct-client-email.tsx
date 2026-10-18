"use client";

import { confirmDialog } from "@/components/shared/confirm-dialog";
import { useState } from "react";

// For a client who has already signed in and whose address turned out to be wrong but
// valid (so it never bounced), the coach can set the right one. The client is told in the app.
export function CorrectClientEmail({
  groupId,
  athleteId,
  clientName,
  currentEmail = null,
}: {
  groupId: string;
  athleteId: string;
  clientName: string;
  // The address on file now, shown above the button and named in the confirmation.
  currentEmail?: string | null;
}) {
  const [open, setOpen] = useState(false);
  const [email, setEmail] = useState("");
  const [confirm, setConfirm] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ kind: "ok" | "error"; text: string } | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (busy) return;
    const first = clientName.split(" ")[0] || "them";
    if (
      !await confirmDialog({
        message: `Ask to change ${first}'s sign-in email${currentEmail ? ` from ${currentEmail}` : ""} to ${email.trim()}? We email that address a link; the email changes only when its owner confirms it. The old address is told right away and ${first} is told in the app. Until then they keep signing in as they do now.`,
        confirmLabel: "Send the confirmation",
      })
    ) {
      return;
    }
    setBusy(true);
    setMessage(null);
    try {
      const res = await fetch("/api/clients/correct-email", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ groupId, athleteId, email, emailConfirm: confirm }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Couldn't change the email.");
      setMessage({
        kind: "ok",
        text: `We sent a confirmation link to ${typeof data.email === "string" ? data.email : "the new address"}. The sign-in email changes only when it is confirmed (within 48 hours); until then nothing is different for ${first}. ${data.oldNotified ? "The old address was told." : ""}`.trim(),
      });
      setEmail("");
      setConfirm("");
    } catch (err) {
      setMessage({ kind: "error", text: err instanceof Error ? err.message : "Couldn't change the email." });
    } finally {
      setBusy(false);
    }
  }

  return (
    <div>
      {currentEmail && <p className="font-body text-xs text-steel mt-4">Sign-in email on file: {currentEmail}</p>}
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="h-11 font-body text-xs text-steel underline underline-offset-2"
      >
        {open ? "Hide" : "Correct their sign-in email"}
      </button>
      {open && (
        <form onSubmit={submit} className="mt-1 space-y-2 max-w-sm">
          <input
            type="email"
            required
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="Correct email"
            aria-label="Correct email"
            className="w-full h-11 bg-graphite border border-steel/30 text-chalk px-3 font-body text-sm focus:outline-none focus:border-rust"
          />
          <input
            type="email"
            required
            value={confirm}
            onChange={(e) => setConfirm(e.target.value)}
            placeholder="Type it again"
            aria-label="Type the email again"
            className="w-full h-11 bg-graphite border border-steel/30 text-chalk px-3 font-body text-sm focus:outline-none focus:border-rust"
          />
          <button
            type="submit"
            disabled={busy}
            className="h-11 px-5 border border-steel/40 text-chalk font-body text-sm disabled:opacity-50"
          >
            {busy ? "Changing…" : "Change email"}
          </button>
          {message && (
            <p className={`font-body text-xs ${message.kind === "error" ? "text-rust" : "text-steel"}`} role="status">
              {message.text}
            </p>
          )}
        </form>
      )}
    </div>
  );
}
