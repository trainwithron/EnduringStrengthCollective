"use client";

import { useState } from "react";

// "Send sign-in link" for one coach, whatever state their account is in: an unused invitation is sent again, anyone else gets a sign-in / password link in their own inbox. The link is never shown here.
export function SendSignInLink({ groupId, profileId, name, label = "Send sign-in link" }: { groupId: string; profileId: string; name: string; label?: string }) {
  const [working, setWorking] = useState(false);
  const [message, setMessage] = useState<{ kind: "ok" | "problem"; text: string } | null>(null);

  async function send() {
    if (working) return;
    setWorking(true);
    setMessage(null);
    try {
      const res = await fetch("/api/coaches/invite/signin", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ groupId, profileId }) });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) setMessage({ kind: "problem", text: data.error || "Couldn't send it. Try again." });
      else if (data.emailed === false) setMessage({ kind: "problem", text: `The email to ${name} did not go out. Try again in a few minutes.` });
      else setMessage({ kind: "ok", text: data.kind === "invitation" ? `Invitation sent again to ${name}.` : `A sign-in link was emailed to ${name}'s own address.` });
    } catch {
      setMessage({ kind: "problem", text: "Couldn't send it. Check your connection and try again." });
    } finally {
      setWorking(false);
    }
  }

  return (
    <>
      <button type="button" onClick={send} disabled={working} className="font-body text-xs underline text-steel disabled:opacity-40">
        {working ? "Sending…" : label}
      </button>
      {message && (
        <p className={`basis-full font-body text-xs ${message.kind === "ok" ? "text-positive" : "text-rust"}`} role={message.kind === "ok" ? "status" : "alert"}>
          {message.text}
        </p>
      )}
    </>
  );
}
