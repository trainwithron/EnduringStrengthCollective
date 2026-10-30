"use client";

import { useState } from "react";
import { buildClaimSms, smsHref } from "@/lib/client-claim";

// One tap from the phone's client list (Ron, Oct 29: "I need to be able to easily send invite links even if they've been sent before ... from mobile"): makes a fresh sign-in link
// (the earlier one stops working, which is fine: this IS the resend) and opens the texting app with the message and link filled in. If the phone does not open it by itself,
// the same message is one more tap below, with Copy next to it.
export function TextSignInLinkButton({ groupId, athleteId, clientName }: { groupId: string; athleteId: string; clientName: string }) {
  const [busy, setBusy] = useState(false);
  const [body, setBody] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const first = clientName.trim().split(" ")[0] ?? "";

  async function send() {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/clients/invite-link", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ groupId, athleteId }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || typeof data.link !== "string") throw new Error(data.error || "Couldn't make the link. Try again.");
      const text = buildClaimSms(data.link, first);
      setBody(text);
      window.location.href = smsHref(text);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn't make the link. Try again.");
    } finally {
      setBusy(false);
    }
  }

  async function copy() {
    if (!body) return;
    try {
      await navigator.clipboard.writeText(body);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      setError("Couldn't copy. Press and hold the message to copy it.");
    }
  }

  return (
    <div className="space-y-2">
      <button type="button" onClick={send} disabled={busy} className="w-full min-h-11 px-4 bg-rust text-graphite font-body text-sm font-medium disabled:opacity-50">
        {busy ? "Making the link…" : body ? "Text a new sign-in link" : "Text sign-in link"}
      </button>
      {body && (
        <div className="flex items-center gap-3">
          <a href={smsHref(body)} className="font-body text-sm text-rust min-h-11 inline-flex items-center">
            Open my texts
          </a>
          <button type="button" onClick={copy} className="font-body text-sm text-steel min-h-11">
            {copied ? "Copied" : "Copy message"}
          </button>
        </div>
      )}
      <p className="font-body text-xs text-steel">Works until {first || "they"} sign{first ? "s" : ""} in. Any earlier link stops working.</p>
      {error && (
        <p className="font-body text-xs text-rust" role="alert">
          {error}
        </p>
      )}
    </div>
  );
}
