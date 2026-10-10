"use client";

import { useState } from "react";
import { confirmDialog } from "@/components/shared/confirm-dialog";

// One plain button: emails the client their sign-in link at the address already on their account. If a working link already exists the coach is asked
// first (the new one replaces it). If the email can't go out, the link comes back so the coach can copy or text it instead.
export function EmailClaimLinkButton({
  groupId,
  athleteId,
  onSent,
  onLink,
}: {
  groupId: string;
  athleteId: string;
  onSent?: () => void;
  // Called with a link the coach should copy or text when the email itself couldn't be sent.
  onLink?: (link: string) => void;
}) {
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ kind: "ok" | "error"; text: string } | null>(null);

  async function send(confirmReplace: boolean) {
    const res = await fetch("/api/clients/email-claim-link", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ groupId, athleteId, confirmReplace }),
    });
    return { res, data: await res.json().catch(() => ({})) };
  }

  async function onClick() {
    if (busy) return;
    setBusy(true);
    setMsg(null);
    try {
      let { res, data } = await send(false);
      if (res.status === 409 && data.needsConfirm) {
        if (!(await confirmDialog({ message: "Email a new sign-in link? The old one stops working.", confirmLabel: "Email new link" }))) return;
        ({ res, data } = await send(true));
      }
      if (res.ok) {
        setMsg({ kind: "ok", text: `Sent to ${data.sentTo}.` });
        onSent?.();
        return;
      }
      if (data.link) onLink?.(data.link);
      setMsg({ kind: "error", text: data.error || "The email couldn't be sent." });
    } catch {
      setMsg({ kind: "error", text: "The email couldn't be sent." });
    } finally {
      setBusy(false);
    }
  }

  return (
    <div>
      <button
        type="button"
        onClick={onClick}
        disabled={busy}
        className="h-11 px-4 bg-rust text-graphite font-body text-sm font-medium disabled:opacity-50"
      >
        {busy ? "Sending…" : "Email the sign-in link"}
      </button>
      {msg && (
        <p className={`font-body text-xs mt-1.5 ${msg.kind === "error" ? "text-rust" : "text-positive"}`} role={msg.kind === "error" ? "alert" : "status"}>
          {msg.text}
        </p>
      )}
    </div>
  );
}
