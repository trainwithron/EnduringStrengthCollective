"use client";

import { useEffect, useState } from "react";
import { buildClaimSms } from "@/lib/client-claim";
import { canShare, shareText } from "@/lib/share-sheet";

// One tap from the phone's client list (Ron, Oct 29: "I need to be able to easily send invite links even if they've been sent before ... from mobile"): makes a fresh sign-in link
// (the earlier one stops working, which is fine: this IS the resend) and opens the phone's share sheet with the message and link, where Copy, texts and every other app are
// (Ron, Oct 31: a Share link button, not a separate Text one). If the sheet does not open by itself, Share and Copy are one more tap below.
export function TextSignInLinkButton({ groupId, athleteId, clientName }: { groupId: string; athleteId: string; clientName: string }) {
  const [busy, setBusy] = useState(false);
  const [body, setBody] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sharable, setSharable] = useState(false);
  useEffect(() => setSharable(canShare()), []);
  const first = clientName.trim().split(" ")[0] ?? "";

  async function makeAndShare() {
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
      void shareText(text);
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
      <button type="button" onClick={makeAndShare} disabled={busy} className="w-full min-h-11 px-4 bg-rust text-graphite font-body text-sm font-medium disabled:opacity-50">
        {busy ? "Making the link…" : body ? "Share a new sign-in link" : "Share sign-in link"}
      </button>
      {body && (
        <div className="flex items-center gap-3">
          {sharable && (
            <button type="button" onClick={() => void shareText(body)} className="font-body text-sm text-rust min-h-11">
              Share
            </button>
          )}
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
