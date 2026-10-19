"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { confirmDialog } from "@/components/shared/confirm-dialog";

// Copy invite link / Email it / Cancel for ONE person who was invited by a new email address and has not accepted yet. The email and the copied link are the SAME link: neither changes or cancels the other. Used in the Invitations list on the Team page and right in the row of the Coaching staff lists, so
// there is one behaviour in both places. The routes check that the person doing it owns or administers the organization; this only asks and shows the plain answers.
export function PendingInviteActions({ groupId, profileId, name, email, sendLabel = "Email it" }: { groupId: string; profileId: string; name: string; email: string; sendLabel?: string }) {
  const router = useRouter();
  const [working, setWorking] = useState<string | null>(null);
  const [message, setMessage] = useState<{ kind: "ok" | "problem"; text: string } | null>(null);
  // A link the browser would not copy for us, shown under this person's row so it can be selected and copied by hand; cleared by the next action.
  const [shownLink, setShownLink] = useState<string | null>(null);

  async function post(path: string): Promise<{ ok: boolean; data: any }> {
    const res = await fetch(path, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ groupId, profileId }) });
    const data = await res.json().catch(() => ({}));
    return { ok: res.ok, data };
  }

  async function resend() {
    setWorking("resend");
    setMessage(null);
    setShownLink(null);
    try {
      const { ok, data } = await post("/api/coaches/invite/resend");
      if (!ok) setMessage({ kind: "problem", text: data.error || "Couldn't send it again. Try again." });
      else if (data.emailed === false) setMessage({ kind: "problem", text: `The email to ${name} did not go out. Use Copy invite link and send it yourself.` });
      else {
        setMessage({ kind: "ok", text: `Emailed to ${email}. It is the same link, good for another 14 days.` });
        router.refresh();
      }
    } catch {
      setMessage({ kind: "problem", text: "Couldn't send it again. Check your connection and try again." });
    } finally {
      setWorking(null);
    }
  }

  async function copyLink() {
    setWorking("copy");
    setMessage(null);
    setShownLink(null);
    try {
      const { ok, data } = await post("/api/coaches/invite/link");
      if (!ok || typeof data.link !== "string") {
        setMessage({ kind: "problem", text: data.error || "Couldn't get the link. Try again." });
        return;
      }
      try {
        await navigator.clipboard.writeText(data.link);
        setMessage({ kind: "ok", text: `Link copied. It is the same link as in the email, good for 14 days, and used up only when ${name} chooses a password.` });
      } catch {
        setShownLink(data.link);
        setMessage({ kind: "ok", text: "Copy this link and send it to the person. It is the same link as in the email." });
      }
    } catch {
      setMessage({ kind: "problem", text: "Couldn't make the link. Check your connection and try again." });
    } finally {
      setWorking(null);
    }
  }

  async function cancel() {
    if (!(await confirmDialog({ message: `Cancel the invitation to ${name}? Their link stops working.`, confirmLabel: "Cancel invitation", cancelLabel: "Keep it", destructive: true }))) return;
    setWorking("cancel");
    setMessage(null);
    setShownLink(null);
    try {
      const { ok, data } = await post("/api/coaches/invite/cancel");
      if (!ok) setMessage({ kind: "problem", text: data.error || "Couldn't cancel that invitation. Try again." });
      else router.refresh();
    } catch {
      setMessage({ kind: "problem", text: "Couldn't cancel that invitation. Check your connection and try again." });
    } finally {
      setWorking(null);
    }
  }

  const button = "font-body text-xs underline disabled:opacity-40";
  return (
    <>
      <div className="flex items-center gap-4">
        <button type="button" onClick={resend} disabled={working !== null} className={`${button} text-steel`}>
          {working === "resend" ? "Sending…" : sendLabel}
        </button>
        <button type="button" onClick={copyLink} disabled={working !== null} className={`${button} text-steel`}>
          {working === "copy" ? "Getting…" : "Copy invite link"}
        </button>
        <button type="button" onClick={cancel} disabled={working !== null} className={`${button} text-rust no-underline`}>
          Cancel
        </button>
      </div>
      <p className="basis-full font-body text-xs text-steel">The email and the copied link are the same link. Copying or emailing it again never cancels anything; opening it does not use it up.</p>
      {shownLink && <input readOnly value={shownLink} onFocus={(e) => e.currentTarget.select()} aria-label="Invitation link" className="basis-full w-full h-10 bg-graphite border border-steel/30 text-chalk px-2.5 font-body text-xs" />}
      {message && (
        <p className={`basis-full font-body text-xs ${message.kind === "ok" ? "text-positive" : "text-rust"}`} role={message.kind === "ok" ? "status" : "alert"}>
          {message.text}
        </p>
      )}
    </>
  );
}
